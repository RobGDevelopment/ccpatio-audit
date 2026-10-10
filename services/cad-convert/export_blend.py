import bpy
import sys
import os

def export_glb(input_blend: str, output_glb: str):
    # Load the blend file
    bpy.ops.wm.open_mainfile(filepath=input_blend)
    
    # Export to GLB
    # Note: Do not touch bpy.context.window in headless mode
    bpy.ops.export_scene.gltf(
        filepath=output_glb,
        export_format='GLB',
        use_selection=False
    )

if __name__ == "__main__":
    # Blender arguments are passed after "--"
    if "--" not in sys.argv:
        print("Usage: blender -b --python export_blend.py -- <input.blend> <output.glb>")
        sys.exit(1)
        
    args = sys.argv[sys.argv.index("--") + 1:]
    if len(args) < 2:
        print("Usage: blender -b --python export_blend.py -- <input.blend> <output.glb>")
        sys.exit(1)
        
    input_blend = os.path.abspath(args[0])
    output_glb = os.path.abspath(args[1])
    export_glb(input_blend, output_glb)
