"""
Stage 0 — Semantic hero split for Ledge Lounger Signature Lowback Chair.

Opens MasterCatalog.blend, isolates the lowback chair, splits its geometry into
Mesh_Frame / Mesh_Seat / Mesh_Pillow, centers the assembly on the floor, and
writes self-contained hero assets for the R3F configurator POC.
"""
import bpy
import bmesh
import gc
import json
import mathutils
import os
import struct
from contextlib import contextmanager


WORKSPACE = r"C:\Workspace\ccpatio-audit"
HERO_ROOT_NAME = "C-Ledge Lounger Signature Lowback Chair"
HERO_DIR = os.path.join(WORKSPACE, "Blender", "dist", "hero")
BLEND_OUT = os.path.join(HERO_DIR, "lowback-chair.blend")
GLB_OUT = os.path.join(HERO_DIR, "lowback-chair.glb")

PART_NAMES = {
    "frame": "Mesh_Frame",
    "seat": "Mesh_Seat",
    "pillow": "Mesh_Pillow",
}


def activate_scene(scene):
    wm = bpy.context.window_manager
    if wm and wm.windows:
        wm.windows[0].scene = scene
    elif bpy.context.window:
        bpy.context.window.scene = scene


@contextmanager
def using_scene(scene):
    view_layer = scene.view_layers[0]
    activate_scene(scene)
    view_layer.update()
    wm = bpy.context.window_manager
    win = wm.windows[0] if wm and wm.windows else bpy.context.window
    override = {"scene": scene, "view_layer": view_layer}
    if win is not None:
        override["window"] = win
    with bpy.context.temp_override(**override):
        view_layer.update()
        yield view_layer


def collect_meshes(root):
    meshes = []
    if root.type == "MESH":
        meshes.append(root)
    for child in root.children:
        meshes.extend(collect_meshes(child))
    return meshes


def get_world_z_range(obj):
    mw = obj.matrix_world
    zs = [(mw @ obj.data.polygons[i].center).z for i in range(len(obj.data.polygons))]
    return min(zs), max(zs)


def categorize_face(poly, mw, zmin, zmax):
    normal = (mw.to_3x3() @ poly.normal).normalized()
    center_z = (mw @ poly.center).z
    height = zmax - zmin
    rel_z = (center_z - zmin) / height if height > 0 else 0

    if normal.z > 0.35 and rel_z >= 0.50:
        return "pillow"
    if normal.z > 0.45 and rel_z < 0.65:
        return "seat"
    return "frame"


def mesh_from_face_indices(source_mesh, face_indices, mesh_name, world_matrix):
    bm_src = bmesh.new()
    bm_src.from_mesh(source_mesh)
    bm_src.faces.ensure_lookup_table()

    bm_dst = bmesh.new()
    vert_map = {}
    for face_index in face_indices:
        face = bm_src.faces[face_index]
        dst_verts = []
        for vert in face.verts:
            key = vert.index
            if key not in vert_map:
                world_co = world_matrix @ vert.co
                vert_map[key] = bm_dst.verts.new(world_co)
            dst_verts.append(vert_map[key])
        bm_dst.faces.new(dst_verts)

    bm_dst.verts.ensure_lookup_table()
    bm_dst.normal_update()
    out_mesh = bpy.data.meshes.new(mesh_name)
    bm_dst.to_mesh(out_mesh)
    out_mesh.update()

    bm_dst.free()
    bm_src.free()
    return out_mesh


def split_mesh_semantic(source_obj):
    """Try material/loose splits first; fall back to normal+height heuristics."""
    mesh = source_obj.data
    world_matrix = source_obj.matrix_world.copy()

    zmin, zmax = get_world_z_range(source_obj)
    groups = {"frame": [], "seat": [], "pillow": []}
    for index, poly in enumerate(mesh.polygons):
        groups[categorize_face(poly, world_matrix, zmin, zmax)].append(index)

    parts = {}
    for key, indices in groups.items():
        if not indices:
            continue
        part_mesh = mesh_from_face_indices(
            mesh,
            indices,
            PART_NAMES[key],
            world_matrix,
        )
        if len(part_mesh.polygons) == 0:
            continue
        obj = bpy.data.objects.new(PART_NAMES[key], part_mesh)
        parts[key] = obj
    return parts


def try_blender_mesh_separators(source_obj, view_layer):
    """Attempt native MATERIAL / LOOSE separation on a duplicate."""
    dup = source_obj.copy()
    dup.data = source_obj.data.copy()
    dup.matrix_world = source_obj.matrix_world.copy()

    proc_scene = bpy.context.scene
    proc_scene.collection.objects.link(dup)
    view_layer.objects.active = dup
    dup.select_set(True)
    view_layer.update()

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")

    before = {obj.name for obj in proc_scene.objects if obj.type == "MESH"}
    try:
        bpy.ops.mesh.separate(type="MATERIAL")
    except Exception:
        pass
    bpy.ops.object.mode_set(mode="OBJECT")

    material_parts = [obj for obj in proc_scene.objects if obj.type == "MESH" and obj.name not in before]
    if len(material_parts) > 1:
        return material_parts

    # Reset and try loose parts on a fresh duplicate
    for obj in list(material_parts):
        proc_scene.collection.objects.unlink(obj)
        bpy.data.objects.remove(obj, do_unlink=True)

    dup = source_obj.copy()
    dup.data = source_obj.data.copy()
    dup.matrix_world = source_obj.matrix_world.copy()
    proc_scene.collection.objects.link(dup)
    view_layer.objects.active = dup
    dup.select_set(True)
    view_layer.update()

    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    before = {obj.name for obj in proc_scene.objects if obj.type == "MESH"}
    try:
        bpy.ops.mesh.separate(type="LOOSE")
    except Exception:
        pass
    bpy.ops.object.mode_set(mode="OBJECT")

    loose_parts = [obj for obj in proc_scene.objects if obj.type == "MESH" and obj.name not in before]
    if len(loose_parts) > 1:
        return loose_parts

    for obj in loose_parts:
        proc_scene.collection.objects.unlink(obj)
        bpy.data.objects.remove(obj, do_unlink=True)
    if dup.name in bpy.data.objects:
        proc_scene.collection.objects.unlink(dup)
        bpy.data.objects.remove(dup, do_unlink=True)
    return []


def classify_part_by_heuristics(obj):
    dims = obj.dimensions
    zmin = min((obj.matrix_world @ mathutils.Vector(corner)).z for corner in obj.bound_box)
    zmax = max((obj.matrix_world @ mathutils.Vector(corner)).z for corner in obj.bound_box)
    zmid = (zmin + zmax) / 2.0
    footprint = dims.x * dims.y
    height = dims.z

    if zmid >= 0.82 and height < 0.35:
        return "pillow"
    if footprint > 0.08 and height < 0.30 and zmid < 0.75:
        return "seat"
    return "frame"


def rename_and_assign_parts(raw_parts):
    named = {}
    if len(raw_parts) >= 2:
        for obj in raw_parts:
            role = classify_part_by_heuristics(obj)
            if role in named:
                role = "frame"
            obj.name = PART_NAMES[role]
            named[role] = obj
        return named
    return {}


def normalize_parts_to_floor(parts, view_layer):
    if not parts:
        return

    min_co = mathutils.Vector((float("inf"), float("inf"), float("inf")))
    max_co = mathutils.Vector((float("-inf"), float("-inf"), float("-inf")))
    for obj in parts.values():
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ mathutils.Vector(corner)
            min_co.x = min(min_co.x, world_corner.x)
            min_co.y = min(min_co.y, world_corner.y)
            min_co.z = min(min_co.z, world_corner.z)
            max_co.x = max(max_co.x, world_corner.x)
            max_co.y = max(max_co.y, world_corner.y)
            max_co.z = max(max_co.z, world_corner.z)

    center_x = (min_co.x + max_co.x) / 2.0
    center_y = (min_co.y + max_co.y) / 2.0
    offset = mathutils.Vector((-center_x, -center_y, -min_co.z))

    for obj in parts.values():
        obj.location += offset
        obj.rotation_euler = (0.0, 0.0, 0.0)
        obj.scale = (1.0, 1.0, 1.0)

    view_layer.update()

    for obj in parts.values():
        obj.select_set(True)
    view_layer.objects.active = next(iter(parts.values()))
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for obj in parts.values():
        obj.select_set(False)
    view_layer.update()


def inspect_glb(path):
    with open(path, "rb") as handle:
        data = handle.read()
    json_index = data.find(b"JSON")
    if json_index < 0:
        return {"valid": False, "nodes": [], "meshes": 0, "size": len(data)}
    json_length = struct.unpack("<I", data[json_index - 4 : json_index])[0]
    payload = json.loads(data[json_index + 4 : json_index + 4 + json_length])
    return {
        "valid": True,
        "nodes": [node.get("name") for node in payload.get("nodes", [])],
        "meshes": len(payload.get("meshes", [])),
        "size": len(data),
    }


def main():
    try:
        bpy.context.preferences.edit.use_global_undo = False
    except Exception:
        pass

    os.makedirs(HERO_DIR, exist_ok=True)

    root = bpy.data.objects.get(HERO_ROOT_NAME)
    if root is None:
        raise RuntimeError(f"Could not find hero root object: {HERO_ROOT_NAME}")

    source_meshes = collect_meshes(root)
    if not source_meshes:
        raise RuntimeError(f"No mesh children found under {HERO_ROOT_NAME}")

    source_obj = max(source_meshes, key=lambda obj: len(obj.data.polygons))
    print(f"Target mesh: {source_obj.name} ({len(source_obj.data.polygons)} faces)")

    hero_scene = bpy.data.scenes.new("Hero_LowbackChair")
    parts = {}

    with using_scene(hero_scene) as view_layer:
        separated = try_blender_mesh_separators(source_obj, view_layer)
        if separated:
            print(f"Native Blender separation produced {len(separated)} parts")
            parts = rename_and_assign_parts(separated)
            for obj in separated:
                if obj.name not in {p.name for p in parts.values()}:
                    hero_scene.collection.objects.link(obj)
        else:
            print("Native separation insufficient; using semantic face heuristic split")
            parts = split_mesh_semantic(source_obj)
            for obj in parts.values():
                hero_scene.collection.objects.link(obj)

        if "frame" not in parts or "seat" not in parts:
            raise RuntimeError("Semantic split failed to produce Mesh_Frame and Mesh_Seat")

        normalize_parts_to_floor(parts, view_layer)

        total_polys = sum(len(obj.data.polygons) for obj in parts.values())
        print(
            "Parts:",
            {key: len(parts[key].data.polygons) for key in sorted(parts.keys())},
            "total_polys=",
            total_polys,
        )

        result = bpy.ops.export_scene.gltf(
            filepath=GLB_OUT,
            export_format="GLB",
            use_selection=False,
            use_visible=False,
            use_renderable=False,
            use_active_collection=False,
            use_active_scene=True,
            export_apply=True,
            export_yup=True,
        )
        if "FINISHED" not in result:
            raise RuntimeError(f"GLB export failed: {result}")

        bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)

    glb_info = inspect_glb(GLB_OUT)
    print("\n=== HERO EXPORT VERIFICATION ===")
    print(f"blend: {BLEND_OUT}")
    print(f"glb:   {GLB_OUT}")
    print(f"size:  {glb_info['size']} bytes")
    print(f"nodes: {glb_info['nodes']}")
    print(f"meshes:{glb_info['meshes']}")

    required = {"Mesh_Frame", "Mesh_Seat"}
    node_set = set(glb_info.get("nodes") or [])
    missing = required - node_set
    if glb_info["size"] < 50_000 or missing:
        raise RuntimeError(
            f"Acceptance gate failed: size={glb_info['size']} missing_nodes={sorted(missing)}"
        )

    print("Acceptance gate: PASSED")
    gc.collect()


if __name__ == "__main__":
    main()
