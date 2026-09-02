import bpy
import bmesh
import json
import os
import gc
import mathutils
import re
from contextlib import contextmanager


def slugify(value):
    # Preserve Blender instance suffixes (.001, .002) as -001 so distinct
    # copies do not collapse into a single SKU. Do NOT strip SketchUp #1 / #2
    # digits — only the '#' punctuation is removed by the charset filter.
    value = re.sub(r'\.(\d{3,})$', r'-\1', value)

    value = re.sub(r'[^\w\s-]', '', value).strip().lower()
    return re.sub(r'[-\s]+', '-', value)


def activate_scene(scene):
    """Switch the active scene without assuming bpy.context.window is set."""
    wm = bpy.context.window_manager
    windows = getattr(wm, "windows", None) if wm is not None else None
    if windows:
        windows[0].scene = scene
        return
    win = bpy.context.window
    if win is not None:
        win.scene = scene


@contextmanager
def using_scene(scene):
    """Bind window/scene/view_layer so bpy.ops hit the temp scene in headless mode."""
    view_layer = scene.view_layers[0]
    activate_scene(scene)
    view_layer.update()
    wm = bpy.context.window_manager
    win = None
    if wm and wm.windows:
        win = wm.windows[0]
    elif bpy.context.window:
        win = bpy.context.window
    override = {"scene": scene, "view_layer": view_layer}
    if win is not None:
        override["window"] = win
    with bpy.context.temp_override(**override):
        bpy.context.view_layer.update()
        yield view_layer


def purge_orphans():
    """Drop unlinked datablocks. Blender 4.x/5.x kwargs, with older fallbacks."""
    try:
        bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
        return
    except TypeError:
        pass
    except AttributeError:
        pass
    try:
        bpy.data.orphans_purge()
        return
    except Exception:
        pass
    try:
        bpy.ops.outliner.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    except Exception:
        pass


def write_manifest(dist_dir, manifest):
    temp_manifest_path = os.path.join(dist_dir, "catalog_manifest.tmp.json")
    final_manifest_path = os.path.join(dist_dir, "catalog_manifest.json")
    with open(temp_manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
    os.replace(temp_manifest_path, final_manifest_path)


class DisjointSet:
    def __init__(self):
        self.parent = {}
    def find(self, item):
        if item not in self.parent:
            self.parent[item] = item
        if self.parent[item] != item:
            self.parent[item] = self.find(self.parent[item])
        return self.parent[item]
    def union(self, set1, set2):
        root1 = self.find(set1)
        root2 = self.find(set2)
        if root1 != root2:
            self.parent[root1] = root2

    def get_clusters(self):
        clusters = {}
        for item in self.parent:
            root = self.find(item)
            if root not in clusters:
                clusters[root] = []
            clusters[root].append(item)
        return list(clusters.values())

def get_aabb(obj):
    corners = [obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box]
    min_v = mathutils.Vector((min([c.x for c in corners]), min([c.y for c in corners]), min([c.z for c in corners])))
    max_v = mathutils.Vector((max([c.x for c in corners]), max([c.y for c in corners]), max([c.z for c in corners])))
    return (min_v, max_v)

def boxes_intersect(b1, b2, padding=0.1):
    for i in range(3):
        if b1[0][i] > b2[1][i] + padding or b2[0][i] > b1[1][i] + padding:
            return False
    return True

def is_ground_plate(obj, aabb):
    dim = aabb[1] - aabb[0]
    # Only filter out MASSIVE showroom floor plates (e.g. > 5m x 5m and very thin)
    if dim.x > 5.0 and dim.y > 5.0 and dim.z < 0.1:
        return True
    return False

def clean_and_normalize(objs, view_layer):
    """Mesh cleanup against the given view layer. Caller must hold using_scene()."""
    for obj in list(view_layer.objects):
        obj.select_set(False, view_layer=view_layer)
    for obj in objs:
        obj.hide_set(False, view_layer=view_layer)
        obj.select_set(True, view_layer=view_layer)
    view_layer.update()

    if objs:
        view_layer.objects.active = objs[0]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

    for obj in objs:
        if obj.type != 'MESH':
            continue
        view_layer.objects.active = obj
        obj.select_set(True, view_layer=view_layer)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.remove_doubles(threshold=0.0001)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.object.mode_set(mode='OBJECT')
        view_layer.update()

    for obj in list(view_layer.objects):
        obj.select_set(False, view_layer=view_layer)
    view_layer.update()

def main():
    try:
        bpy.context.preferences.edit.use_global_undo = False
    except Exception as e:
        print(f"Could not disable global undo: {e}")

    workspace = r"C:\Workspace\ccpatio-audit"
    dist_dir = os.path.join(workspace, "Blender", "dist")
    blend_dir = os.path.join(dist_dir, "blend")
    glb_dir = os.path.join(dist_dir, "glb")

    os.makedirs(blend_dir, exist_ok=True)
    os.makedirs(glb_dir, exist_ok=True)

    scene = bpy.context.scene
    all_meshes = [obj for obj in scene.objects if obj.type == 'MESH' and not obj.hide_viewport]

    furniture_meshes = []
    mesh_aabbs = {}
    for obj in all_meshes:
        aabb = get_aabb(obj)
        if not is_ground_plate(obj, aabb):
            furniture_meshes.append(obj)
            mesh_aabbs[obj.name] = aabb

    # 1. Group by Immediate Parent
    parent_groups = {}
    unparented = []

    for obj in furniture_meshes:
        if obj.parent:
            root_key = obj.parent.name
            if root_key not in parent_groups:
                parent_groups[root_key] = []
            parent_groups[root_key].append(obj)
        else:
            unparented.append(obj)

    # 2. Spatial clustering for unparented meshes
    ds = DisjointSet()
    for m in unparented:
        ds.find(m.name)

    for i, m1 in enumerate(unparented):
        b1 = mesh_aabbs[m1.name]
        for j in range(i+1, len(unparented)):
            m2 = unparented[j]
            b2 = mesh_aabbs[m2.name]
            if boxes_intersect(b1, b2, padding=0.1):
                ds.union(m1.name, m2.name)

    clusters = ds.get_clusters()

    all_groups = list(parent_groups.values())
    for cluster_names in clusters:
        group_objs = [scene.objects[name] for name in cluster_names]
        all_groups.append(group_objs)

    manifest = []
    processed_skus = set()

    for idx, objs in enumerate(all_groups):
        if not objs:
            continue

        if objs[0].parent:
            raw_key = objs[0].parent.name
        elif objs[0].users_collection:
            raw_key = objs[0].users_collection[0].name
        else:
            raw_key = f"product_{idx:03d}"

        sku_slug = slugify(raw_key)

        # If the slug is too generic, append index to keep it unique
        if not sku_slug or sku_slug in ["skp-mesh-objects", "collection", "mastercatalog"]:
            sku_slug = f"product_{idx:03d}"

        # Deduplicate only exact slug matches (instance suffixes now remain unique).
        if sku_slug in processed_skus:
            continue

        min_co = [float('inf')] * 3
        max_co = [float('-inf')] * 3
        for obj in objs:
            bmin, bmax = mesh_aabbs.get(obj.name, get_aabb(obj))
            for i in range(3):
                min_co[i] = min(min_co[i], bmin[i])
                max_co[i] = max(max_co[i], bmax[i])

        dim_x = max_co[0] - min_co[0]
        dim_y = max_co[1] - min_co[1]
        dim_z = max_co[2] - min_co[2]

        # Ignore tiny stray pieces (like a single 2" leg)
        if dim_x < 0.2 or dim_y < 0.2: # Footprint < 8 inches
            continue
        if max(dim_x, dim_y, dim_z) < 0.3: # Max dimension < 12 inches
            continue

        processed_skus.add(sku_slug)
        process_export(scene, objs, (mathutils.Vector(min_co), mathutils.Vector(max_co)), sku_slug, blend_dir, manifest)

        # Atomic write after every iteration so a mid-batch kill still leaves valid JSON.
        write_manifest(dist_dir, manifest)

    write_manifest(dist_dir, manifest)
    print(f"\nPipeline finished. Extracted {len(manifest)} unique .blend SKUs.")
    print("Run scripts/convert_blend_to_glb.py in a separate Blender session to generate GLBs.")

def process_export(base_scene, objs, aabb, sku_slug, blend_dir, manifest):
    min_co, max_co = aabb
    dim_x = max_co[0] - min_co[0]
    dim_y = max_co[1] - min_co[1]
    dim_z = max_co[2] - min_co[2]

    center_x = (min_co[0] + max_co[0]) / 2.0
    center_y = (min_co[1] + max_co[1]) / 2.0
    bottom_z = min_co[2]
    offset = mathutils.Vector((-center_x, -center_y, -bottom_z))

    proc_scene = None
    proc_objs = []
    total_polys = 0
    mat_slots = []
    succeeded = False

    try:
        proc_scene = bpy.data.scenes.new(name=f"proc_{sku_slug}")
        for orig_obj in objs:
            new_obj = orig_obj.copy()
            new_obj.data = orig_obj.data.copy()
            proc_scene.collection.objects.link(new_obj)
            proc_objs.append(new_obj)

        blend_path = os.path.join(blend_dir, f"{sku_slug}.blend")

        with using_scene(proc_scene) as view_layer:
            for obj in proc_objs:
                obj.hide_viewport = False
                obj.hide_render = False
                obj.hide_set(False, view_layer=view_layer)
                obj.location += offset

            view_layer.update()
            clean_and_normalize(proc_objs, view_layer)
            view_layer.update()

            total_polys = sum(len(o.data.polygons) for o in proc_objs if o.type == 'MESH')
            mat_slots = list(set([slot.material.name for o in proc_objs for slot in o.material_slots if slot.material]))

            # Write the isolated SKU as a .blend only. GLB conversion is a
            # second Blender process (scripts/convert_blend_to_glb.py) that
            # opens each file natively so the glTF exporter gets a real view layer.
            bpy.data.libraries.write(
                filepath=blend_path,
                datablocks=set(proc_objs) | {proc_scene},
            )
            succeeded = True

    except Exception as e:
        print(f"CRITICAL ERROR on {sku_slug}: {e}")

    finally:
        try:
            if bpy.context.mode != 'OBJECT':
                bpy.ops.object.mode_set(mode='OBJECT')
        except Exception:
            pass

        try:
            activate_scene(base_scene)
        except Exception as e:
            print(f"Scene revert failed for {sku_slug}: {e}")

        if proc_scene is not None:
            try:
                bpy.data.scenes.remove(proc_scene)
            except Exception as e:
                print(f"Could not remove proc scene for {sku_slug}: {e}")

        purge_orphans()
        gc.collect()

    if not succeeded:
        return

    manifest.append({
        "sku": sku_slug,
        "dimensions_imperial": {
            "width_in": round(dim_x * 39.3701, 1),
            "depth_in": round(dim_y * 39.3701, 1),
            "height_in": round(dim_z * 39.3701, 1)
        },
        "poly_count": total_polys,
        "materials": mat_slots,
        "assets": {
            "blend": f"blend/{sku_slug}.blend",
            "glb": f"glb/{sku_slug}.glb"
        }
    })
    print(f"[EXPORTED] {sku_slug} -> W:{round(dim_x*39.3701, 1)}\" D:{round(dim_y*39.3701, 1)}\" H:{round(dim_z*39.3701, 1)}\"")

if __name__ == "__main__":
    main()
