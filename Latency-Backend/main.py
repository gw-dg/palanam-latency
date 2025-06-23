from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil
import uuid
import logging
from classify import process_video, test_classifier
from pathlib import Path

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# CORS origins - add your frontend URL
origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]

app = FastAPI(title="NSFW Video Detector API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create directories
UPLOAD_DIR = "videos"
TEMP_DIR = "temp"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(TEMP_DIR, exist_ok=True)

# Supported video formats
SUPPORTED_FORMATS = {
    'video/mp4': '.mp4',
    'video/avi': '.avi',
    'video/mov': '.mov',
    'video/quicktime': '.mov',
    'video/x-msvideo': '.avi',
    'video/webm': '.webm'
}

@app.on_event("startup")
async def startup_event():
    """Test classifier on startup"""
    logger.info("Starting up NSFW Video Detector API...")
    if test_classifier():
        logger.info("✅ NSFW classifier loaded and tested successfully")
    else:
        logger.error("❌ NSFW classifier failed to load")
        raise Exception("Failed to initialize NSFW classifier")

@app.get("/")
def root():
    return {
        "message": "NSFW Video Detector API", 
        "version": "1.0.0",
        "status": "running"
    }

@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "classifier": "loaded"}

@app.post("/process-video/")
async def process_uploaded_video(file: UploadFile = File(...)):
    """
    Process uploaded video through NSFW detection model
    """
    logger.info(f"Received video upload: {file.filename}")
    
    # Validate file type
    if file.content_type not in SUPPORTED_FORMATS:
        logger.error(f"Unsupported file type: {file.content_type}")
        raise HTTPException(
            status_code=400, 
            detail=f"Unsupported file type. Supported formats: {list(SUPPORTED_FORMATS.keys())}"
        )
    
    # Validate file size (limit to 100MB)
    file_size = 0
    content = await file.read()
    file_size = len(content)
    
    if file_size > 100 * 1024 * 1024:  # 100MB limit
        logger.error(f"File too large: {file_size} bytes")
        raise HTTPException(
            status_code=400,
            detail="File too large. Maximum size is 100MB."
        )
    
    # Reset file pointer
    await file.seek(0)
    
    # Generate unique filenames
    unique_id = str(uuid.uuid4())
    file_extension = SUPPORTED_FORMATS.get(file.content_type, '.mp4')
    
    input_filename = f"input_{unique_id}{file_extension}"
    output_filename = f"processed_{unique_id}.mp4"
    
    input_path = os.path.join(TEMP_DIR, input_filename)
    output_path = os.path.join(TEMP_DIR, output_filename)
    
    try:
        # Save uploaded file
        logger.info(f"Saving uploaded file to: {input_path}")
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        # Verify file was saved
        if not os.path.exists(input_path):
            raise Exception("Failed to save uploaded file")
        
        file_size_mb = os.path.getsize(input_path) / (1024 * 1024)
        logger.info(f"File saved successfully. Size: {file_size_mb:.2f} MB")
        
        # Process video
        logger.info("Starting video processing...")
        process_video(input_path, output_path)
        
        # Verify output file was created
        if not os.path.exists(output_path):
            raise Exception("Video processing failed - no output file created")
        
        output_size_mb = os.path.getsize(output_path) / (1024 * 1024)
        logger.info(f"Video processing completed. Output size: {output_size_mb:.2f} MB")
        
        # Return processed video
        return FileResponse(
            output_path,
            media_type="video/mp4",
            filename=f"processed_{file.filename}",
            headers={
                "Content-Disposition": f"attachment; filename=processed_{file.filename}"
            }
        )
    
    except Exception as e:
        logger.error(f"Error processing video: {str(e)}")
        
        # Clean up files on error
        for path in [input_path, output_path]:
            if os.path.exists(path):
                try:
                    os.remove(path)
                    logger.info(f"Cleaned up file: {path}")
                except Exception as cleanup_error:
                    logger.error(f"Failed to cleanup file {path}: {cleanup_error}")
        
        raise HTTPException(
            status_code=500, 
            detail=f"Video processing failed: {str(e)}"
        )

@app.delete("/cleanup")
def cleanup_temp_files():
    """Clean up temporary files"""
    try:
        temp_files = []
        for directory in [TEMP_DIR, UPLOAD_DIR]:
            if os.path.exists(directory):
                for filename in os.listdir(directory):
                    file_path = os.path.join(directory, filename)
                    if os.path.isfile(file_path):
                        os.remove(file_path)
                        temp_files.append(filename)
        
        logger.info(f"Cleaned up {len(temp_files)} temporary files")
        return {"message": f"Cleaned up {len(temp_files)} files", "files": temp_files}
    
    except Exception as e:
        logger.error(f"Cleanup failed: {e}")
        raise HTTPException(status_code=500, detail=f"Cleanup failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting server...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")