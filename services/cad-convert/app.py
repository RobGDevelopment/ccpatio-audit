import os
import subprocess
import tempfile
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
import trimesh

app = FastAPI(title="CAD Convert Service")

@app.post("/convert")
async def convert_cad(file: UploadFile = File(...)):
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    
    if ext == ".skp":
        raise HTTPException(status_code=415, detail="SKP_CONVERT_UNAVAILABLE")
        
    if ext != ".blend":
        raise HTTPException(status_code=400, detail="Only .blend conversion is supported")
        
    # Process .blend
    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, "input.blend")
        output_path = os.path.join(tmpdir, "output.glb")
        
        with open(input_path, "wb") as f:
            f.write(await file.read())
            
        # Run blender headless
        # Expect blender to be in PATH
        blender_cmd = [
            "blender", "-b", "--python", 
            os.path.join(os.path.dirname(__file__), "export_blend.py"),
            "--", input_path, output_path
        ]
        
        try:
            subprocess.run(blender_cmd, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as e:
            raise HTTPException(status_code=500, detail=f"Blender export failed: {e.stderr}")
        except (FileNotFoundError, PermissionError):
            raise HTTPException(status_code=500, detail="Blender executable not found in PATH or permission denied")
            
        if not os.path.exists(output_path):
            raise HTTPException(status_code=500, detail="Output GLB not generated")
            
        scene = trimesh.load(output_path, force='scene')
            
        if not scene.geometry or sum(len(getattr(g, 'faces', [])) for g in scene.geometry.values()) == 0:
            raise HTTPException(status_code=500, detail="GLB_LOAD_FAILED")
            
        # Returning the file
        # We need to read it into memory to return it since the tempdir will be destroyed
        with open(output_path, "rb") as f:
            content = f.read()
            
        from fastapi.responses import Response
        return Response(content=content, media_type="model/gltf-binary")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
