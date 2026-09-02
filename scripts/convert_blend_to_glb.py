import bpy
import os


def ensure_objects_in_scene(scene):
    """Link datablocks into the active scene.

    extract_catalog.py writes SKUs via bpy.data.libraries.write. Opening those
    files natively loads an empty scene while the meshes sit unlinked in
    bpy.data.objects. Without this step the glTF exporter still sees nothing.
    """
    for obj in list(bpy.data.objects):
        if obj.name not in scene.objects:
            try:
                scene.collection.objects.link(obj)
            except RuntimeError:
                pass
    if scene.view_layers:
        scene.view_layers[0].update()


def convert_blends_to_glbs(blend_dir, glb_dir):
    os.makedirs(glb_dir, exist_ok=True)

    blend_names = sorted(
        name for name in os.listdir(blend_dir) if name.lower().endswith(".blend")
    )
    converted = 0
    skipped = 0

    for filename in blend_names:
        blend_path = os.path.join(blend_dir, filename)
        sku_slug = os.path.splitext(filename)[0]
        glb_path = os.path.join(glb_dir, f"{sku_slug}.glb")

        print(f"Converting: {filename} -> {sku_slug}.glb")

        try:
            # 1. Open the file natively (resets active scene / view layer).
            bpy.ops.wm.open_mainfile(filepath=blend_path, load_ui=False)
            ensure_objects_in_scene(bpy.context.scene)

            # 2. Select all meshes
            bpy.ops.object.select_all(action="DESELECT")
            meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
            for obj in meshes:
                obj.select_set(True)

            if not meshes:
                print(f"Warning: No meshes found in {filename}. Skipping.")
                skipped += 1
                continue

            bpy.context.view_layer.objects.active = meshes[0]
            bpy.context.view_layer.update()

            # 3. Export to GLB
            result = bpy.ops.export_scene.gltf(
                filepath=glb_path,
                export_format="GLB",
                use_selection=True,
                export_apply=True,
                export_yup=True,
            )
            if "FINISHED" not in result:
                print(f"Warning: glTF export did not finish for {filename}: {result}")
                skipped += 1
                continue

            glb_size = os.path.getsize(glb_path) if os.path.exists(glb_path) else 0
            if glb_size < 512:
                print(f"Warning: {sku_slug}.glb looks empty ({glb_size} bytes).")
                skipped += 1
                continue

            converted += 1
            print(f"Successfully exported {sku_slug}.glb ({glb_size} bytes)")
        except Exception as e:
            print(f"CRITICAL ERROR converting {filename}: {e}")
            skipped += 1

    print(f"\nConverted {converted} / {len(blend_names)} blends ({skipped} skipped).")


if __name__ == "__main__":
    workspace = r"C:\Workspace\ccpatio-audit"
    dist_dir = os.path.join(workspace, "Blender", "dist")
    blend_dir = os.path.join(dist_dir, "blend")
    glb_dir = os.path.join(dist_dir, "glb")

    convert_blends_to_glbs(blend_dir, glb_dir)
    print("\nGLB Conversion Pipeline Complete.")
