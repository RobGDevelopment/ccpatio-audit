import os
import subprocess
import tempfile
import hmac
import hashlib
import json
import time
from datetime import datetime, timezone
import urllib.request
import urllib.error
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, Header, HTTPException, BackgroundTasks, Response
from fastapi.responses import JSONResponse
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
            
        with open(output_path, "rb") as f:
            content = f.read()
            
        return Response(content=content, media_type="model/gltf-binary")


def _execute_async_blend_job(
    file_bytes: bytes,
    job_id: str,
    upload_id: str,
    callback_url: str,
    result_upload_url: str,
):
    secret = os.environ.get("CAD_CALLBACK_SECRET", "")
    finished_at = datetime.now(timezone.utc).isoformat()
    
    status = "failed"
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    result_sha256: Optional[str] = None

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = os.path.join(tmpdir, "input.blend")
            output_path = os.path.join(tmpdir, "output.glb")

            with open(input_path, "wb") as f:
                f.write(file_bytes)

            blender_cmd = [
                "blender", "-b", "--python",
                os.path.join(os.path.dirname(__file__), "export_blend.py"),
                "--", input_path, output_path
            ]

            try:
                subprocess.run(blender_cmd, check=True, capture_output=True, text=True)
            except subprocess.CalledProcessError:
                error_code = "BLENDER_EXPORT_FAILED"
                error_message = "Blender headless export failed"
                raise
            except (FileNotFoundError, PermissionError):
                error_code = "BLENDER_NOT_FOUND"
                error_message = "Blender executable not found or permission denied"
                raise

            if not os.path.exists(output_path):
                error_code = "OUTPUT_NOT_FOUND"
                error_message = "Output GLB file was not created"
                raise RuntimeError(error_message)

            scene = trimesh.load(output_path, force='scene')
            if not scene.geometry or sum(len(getattr(g, 'faces', [])) for g in scene.geometry.values()) == 0:
                error_code = "GLB_LOAD_FAILED"
                error_message = "Generated GLB geometry contains zero faces or failed validation"
                raise RuntimeError(error_message)

            with open(output_path, "rb") as f:
                glb_bytes = f.read()

            result_sha256 = hashlib.sha256(glb_bytes).hexdigest()

            # Upload GLB to result_upload_url
            put_req = urllib.request.Request(
                result_upload_url,
                data=glb_bytes,
                headers={"Content-Type": "model/gltf-binary"},
                method="PUT",
            )
            with urllib.request.urlopen(put_req, timeout=60) as put_res:
                if put_res.status not in (200, 201, 204):
                    error_code = "STORAGE_UPLOAD_FAILED"
                    error_message = f"Storage PUT failed with status {put_res.status}"
                    raise RuntimeError(error_message)

            status = "succeeded"
    except Exception as e:
        if not error_code:
            error_code = "CONVERT_FAILED"
            error_message = "CAD conversion failed unexpectedly"

    # Prepare callback payload
    payload: dict = {
        "jobId": job_id,
        "uploadId": upload_id,
        "status": status,
        "finishedAt": datetime.now(timezone.utc).isoformat(),
    }
    if status == "succeeded":
        payload["resultSha256"] = result_sha256
    else:
        payload["errorCode"] = error_code or "UNKNOWN_ERROR"
        payload["errorMessage"] = error_message or "Unknown failure"

    raw_body = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    headers = {"Content-Type": "application/json"}
    if secret:
        sig = hmac.new(secret.encode('utf-8'), raw_body, hashlib.sha256).hexdigest()
        headers["X-CCPatio-Signature"] = f"sha256={sig}"

    # Retried post to callback_url with capped exponential backoff (2xx delivered, 5xx retry)
    backoff = 1.0
    for attempt in range(4):
        try:
            cb_req = urllib.request.Request(
                callback_url,
                data=raw_body,
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(cb_req, timeout=15) as res:
                if 200 <= res.status < 300:
                    break
        except urllib.error.HTTPError as he:
            if 500 <= he.code < 600 and attempt < 3:
                time.sleep(backoff)
                backoff = min(backoff * 2, 8.0)
                continue
            break
        except Exception:
            if attempt < 3:
                time.sleep(backoff)
                backoff = min(backoff * 2, 8.0)
                continue
            break


@app.post("/convert/async", status_code=202)
async def convert_cad_async(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    job_id: str = Form(...),
    callback_url: str = Form(...),
    result_upload_url: str = Form(...),
    upload_id: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
):
    token = os.environ.get("CAD_CONVERT_TOKEN", "").strip()
    if token:
        expected = f"Bearer {token}"
        if not authorization or authorization.strip() != expected:
            raise HTTPException(status_code=401, detail="Invalid CAD convert token")

    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()

    if ext == ".skp":
        raise HTTPException(status_code=415, detail="SKP_CONVERT_UNAVAILABLE")

    if ext != ".blend":
        raise HTTPException(status_code=400, detail="Only .blend conversion is supported")

    file_bytes = await file.read()
    effective_upload_id = upload_id.strip() if upload_id else job_id

    background_tasks.add_task(
        _execute_async_blend_job,
        file_bytes=file_bytes,
        job_id=job_id,
        upload_id=effective_upload_id,
        callback_url=callback_url,
        result_upload_url=result_upload_url,
    )

    return JSONResponse(
        status_code=202,
        content={"accepted": True, "job_id": job_id},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
