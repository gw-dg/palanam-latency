from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import uuid
import logging
import asyncio
import json
from typing import Dict
from pathlib import Path
import cv2
from transformers import pipeline
from PIL import Image
import numpy as np
import time

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize the classifier globally
try:
    classifier = pipeline("image-classification", model="perrytheplatypus/falconsai-finetuned-nsfw-detect")
    logger.info("NSFW classifier loaded successfully")
except Exception as e:
    logger.error(f"Failed to load classifier: {e}")
    classifier = None

# CORS origins
origins = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
]

app = FastAPI(title="Real-time NSFW Video Detector API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create directories
TEMP_DIR = "temp"
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

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.video_captures: Dict[str, cv2.VideoCapture] = {}
        self.video_info: Dict[str, dict] = {}
        self.processing_tasks: Dict[str, asyncio.Task] = {}
        self.video_paths: Dict[str, str] = {}

    async def connect(self, websocket: WebSocket, session_id: str):
        await websocket.accept()
        self.active_connections[session_id] = websocket
        logger.info(f"WebSocket connected: {session_id}")
        
        # Send connection confirmation
        await self.send_message(session_id, {
            "type": "connection_established",
            "session_id": session_id
        })

    def disconnect(self, session_id: str):
        logger.info(f"Starting disconnect cleanup for session: {session_id}")
        
        # Stop processing task
        if session_id in self.processing_tasks:
            task = self.processing_tasks[session_id]
            if not task.done():
                task.cancel()
                logger.info(f"Cancelled processing task for {session_id}")
            del self.processing_tasks[session_id]
        
        # Close WebSocket connection
        if session_id in self.active_connections:
            del self.active_connections[session_id]
            logger.info(f"Removed WebSocket connection for {session_id}")
        
        # Clean up video capture
        if session_id in self.video_captures:
            try:
                self.video_captures[session_id].release()
                logger.info(f"Released video capture for {session_id}")
            except Exception as e:
                logger.error(f"Error releasing video capture for {session_id}: {e}")
            del self.video_captures[session_id]
        
        # Clean up video info
        if session_id in self.video_info:
            del self.video_info[session_id]
            logger.info(f"Cleaned up video info for {session_id}")
        
        # Clean up video path
        if session_id in self.video_paths:
            video_path = self.video_paths[session_id]
            try:
                if os.path.exists(video_path):
                    os.remove(video_path)
                    logger.info(f"Deleted video file: {video_path}")
            except Exception as e:
                logger.error(f"Error deleting video file {video_path}: {e}")
            del self.video_paths[session_id]
            
        logger.info(f"Completed disconnect cleanup for session: {session_id}")

    async def send_message(self, session_id: str, data: dict):
        if session_id in self.active_connections:
            try:
                await self.active_connections[session_id].send_text(json.dumps(data))
                logger.debug(f"Sent message to {session_id}: {data['type']}")
            except Exception as e:
                logger.error(f"Error sending message to {session_id}: {e}")
                self.disconnect(session_id)

    def initialize_video(self, session_id: str, video_path: str):
        """Initialize video capture for a session with enhanced logging"""
        logger.info(f"Initializing video for session {session_id}")
        logger.info(f"Video path: {video_path}")
        logger.info(f"File exists: {os.path.exists(video_path)}")
        
        if os.path.exists(video_path):
            file_size = os.path.getsize(video_path)
            logger.info(f"File size: {file_size} bytes")
        
        try:
            cap = cv2.VideoCapture(video_path)
            
            if not cap.isOpened():
                logger.error(f"OpenCV could not open video file: {video_path}")
                logger.error(f"OpenCV backend: {cv2.getBuildInformation()}")
                return False

            # Get video properties
            fps = cap.get(cv2.CAP_PROP_FPS)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            duration = total_frames / fps if fps > 0 else 0

            logger.info(f"Video properties - FPS: {fps}, Frames: {total_frames}, Resolution: {width}x{height}")

            # Test reading first frame
            ret, frame = cap.read()
            if not ret:
                logger.error(f"Could not read first frame from video: {video_path}")
                cap.release()
                return False
            
            logger.info(f"Successfully read first frame: {frame.shape}")
            
            # Reset to beginning
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

            self.video_captures[session_id] = cap
            self.video_paths[session_id] = video_path
            self.video_info[session_id] = {
                "fps": fps,
                "duration": duration,
                "total_frames": total_frames,
                "width": width,
                "height": height
            }

            logger.info(f"Video successfully initialized for {session_id}: FPS={fps}, Duration={duration:.2f}s")
            return True
            
        except Exception as e:
            logger.error(f"Exception during video initialization for {session_id}: {e}")
            logger.error(f"Exception type: {type(e).__name__}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            return False

    async def process_frame_at_timestamp(self, session_id: str, timestamp: float):
        """Process a specific frame at given timestamp with enhanced logging"""
        if not classifier:
            logger.error(f"Classifier not available for session {session_id}")
            await self.send_message(session_id, {
                "type": "error",
                "message": "Classifier not available"
            })
            return

        if session_id not in self.video_captures:
            logger.error(f"Video not initialized for session {session_id}")
            await self.send_message(session_id, {
                "type": "error",
                "message": "Video not initialized"
            })
            return

        try:
            cap = self.video_captures[session_id]
            video_info = self.video_info[session_id]
            
            # Calculate frame number from timestamp
            frame_number = int(timestamp * video_info["fps"])
            
            # Ensure frame number is within bounds
            if frame_number >= video_info["total_frames"]:
                logger.warning(f"Frame {frame_number} beyond video length for {session_id}")
                return
            
            logger.debug(f"Processing frame {frame_number} at {timestamp:.2f}s for {session_id}")
            
            # Set video position
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_number)
            
            # Read frame
            ret, frame = cap.read()
            if not ret:
                logger.warning(f"Could not read frame {frame_number} for {session_id}")
                return

            logger.debug(f"Successfully read frame {frame_number}: {frame.shape}")

            # Convert BGR to RGB for PIL
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_image = Image.fromarray(rgb_frame)

            # Get classification
            logger.debug(f"Running classification for frame {frame_number}")
            result = classifier(pil_image)[0]
            
            classification_data = {
                "type": "classification",
                "timestamp": timestamp,
                "frame": frame_number,
                "label": result["label"],
                "confidence": float(result["score"]),
                "is_nsfw": result["label"].lower() != "normal"
            }

            # Send classification to frontend
            await self.send_message(session_id, classification_data)
            
            logger.info(f"CLASSIFICATION - Session: {session_id}, Frame: {frame_number}, Time: {timestamp:.2f}s, Result: {result['label']} ({result['score']:.3f})")

        except Exception as e:
            logger.error(f"Error processing frame for {session_id}: {e}")
            import traceback
            logger.error(f"Traceback: {traceback.format_exc()}")
            await self.send_message(session_id, {
                "type": "error",
                "message": f"Frame processing error: {str(e)}"
            })

    async def start_continuous_processing(self, session_id: str):
        """Start continuous processing of video frames"""
        logger.info(f"Starting continuous processing for session {session_id}")
        
        if session_id not in self.video_info:
            logger.error(f"No video info for session {session_id}")
            return
        
        video_info = self.video_info[session_id]
        duration = video_info["duration"]
        processing_interval = 0.5  # Process every 0.5 seconds
        
        logger.info(f"Will process {duration / processing_interval:.0f} frames over {duration:.1f}s")
        
        try:
            current_time = 0.0
            while current_time < duration and session_id in self.active_connections:
                await self.process_frame_at_timestamp(session_id, current_time)
                current_time += processing_interval
                
                # Small delay to prevent overwhelming
                await asyncio.sleep(0.1)
                
            logger.info(f"Completed continuous processing for session {session_id}")
            
        except asyncio.CancelledError:
            logger.info(f"Continuous processing cancelled for session {session_id}")
        except Exception as e:
            logger.error(f"Error in continuous processing for {session_id}: {e}")
            await self.send_message(session_id, {
                "type": "error",
                "message": f"Processing error: {str(e)}"
            })

manager = ConnectionManager()

@app.get("/")
def root():
    return {
        "message": "Real-time NSFW Video Detector API", 
        "version": "3.0.0",
        "status": "running"
    }

@app.get("/health")
def health_check():
    """Health check endpoint"""
    classifier_status = "loaded" if classifier else "failed"
    return {
        "status": "healthy", 
        "classifier": classifier_status,
        "active_connections": len(manager.active_connections)
    }

@app.post("/upload-video/")
async def upload_video(file: UploadFile = File(...)):
    """Upload video and return session ID with enhanced logging"""
    logger.info(f"=== VIDEO UPLOAD STARTED ===")
    logger.info(f"Filename: {file.filename}")
    logger.info(f"Content type: {file.content_type}")
    
    # Validate file type
    if file.content_type not in SUPPORTED_FORMATS:
        logger.error(f"Unsupported file type: {file.content_type}")
        raise HTTPException(
            status_code=400, 
            detail=f"Unsupported file type. Supported formats: {list(SUPPORTED_FORMATS.keys())}"
        )
    
    # Validate file size (limit to 100MB)
    content = await file.read()
    file_size = len(content)
    logger.info(f"File size: {file_size} bytes ({file_size/(1024*1024):.2f} MB)")
    
    if file_size > 100 * 1024 * 1024:  # 100MB limit
        logger.error(f"File too large: {file_size} bytes")
        raise HTTPException(
            status_code=400,
            detail="File too large. Maximum size is 100MB."
        )
    
    # Generate unique session ID and filename
    session_id = str(uuid.uuid4())
    file_extension = SUPPORTED_FORMATS.get(file.content_type, '.mp4')
    filename = f"video_{session_id}{file_extension}"
    file_path = os.path.join(TEMP_DIR, filename)
    
    logger.info(f"Session ID: {session_id}")
    logger.info(f"Saving to: {file_path}")
    
    try:
        # Save uploaded file
        with open(file_path, "wb") as buffer:
            buffer.write(content)
        
        # Verify file was saved
        if not os.path.exists(file_path):
            raise Exception("File was not saved properly")
        
        saved_size = os.path.getsize(file_path)
        logger.info(f"File saved successfully. Size on disk: {saved_size} bytes")
        
        if saved_size != file_size:
            logger.warning(f"File size mismatch! Expected: {file_size}, Got: {saved_size}")
        
        logger.info(f"=== VIDEO UPLOAD COMPLETED ===")
        
        return {
            "session_id": session_id,
            "filename": file.filename,
            "file_size_mb": round(file_size / (1024 * 1024), 2),
            "message": "Video uploaded successfully. Connect to WebSocket for real-time processing."
        }
    
    except Exception as e:
        logger.error(f"Error saving video: {str(e)}")
        # Clean up on error
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to save video: {str(e)}"
        )

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    """WebSocket endpoint for real-time video processing with enhanced flow"""
    logger.info(f"=== WEBSOCKET CONNECTION STARTED for {session_id} ===")
    
    await manager.connect(websocket, session_id)
    
    try:
        # Find video file
        video_files = [f for f in os.listdir(TEMP_DIR) if f.startswith(f"video_{session_id}")]
        logger.info(f"Looking for video files with pattern: video_{session_id}*")
        logger.info(f"Found files: {video_files}")
        
        if not video_files:
            error_msg = f"Video file not found for session {session_id}. Please upload a video first."
            logger.error(error_msg)
            await manager.send_message(session_id, {
                "type": "error",
                "message": error_msg
            })
            return
        
        video_path = os.path.join(TEMP_DIR, video_files[0])
        logger.info(f"Using video file: {video_path}")
        
        # Initialize video capture
        logger.info(f"Initializing video capture...")
        if not manager.initialize_video(session_id, video_path):
            error_msg = f"Failed to initialize video processing for {session_id}"
            logger.error(error_msg)
            await manager.send_message(session_id, {
                "type": "error",
                "message": error_msg
            })
            return

        # Send video info
        video_info = manager.video_info[session_id]
        await manager.send_message(session_id, {
            "type": "video_info",
            **video_info
        })
        logger.info(f"Sent video info to client: {video_info}")

        # Start continuous processing task
        logger.info(f"Starting continuous processing task...")
        processing_task = asyncio.create_task(
            manager.start_continuous_processing(session_id)
        )
        manager.processing_tasks[session_id] = processing_task
        
        # Listen for messages from client
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                data = json.loads(message)
                logger.debug(f"Received message from {session_id}: {data.get('type')}")
                
                if data.get("type") == "process_frame":
                    timestamp = data.get("timestamp", 0)
                    # Process specific frame (in addition to continuous processing)
                    await manager.process_frame_at_timestamp(session_id, timestamp)
                elif data.get("type") == "connect":
                    logger.info(f"Connection acknowledged for {session_id}")
                else:
                    logger.info(f"Unknown message type from {session_id}: {data.get('type')}")
                    
            except asyncio.TimeoutError:
                # Send ping to keep connection alive
                await manager.send_message(session_id, {"type": "ping"})
            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected: {session_id}")
                break
                
    except Exception as e:
        logger.error(f"WebSocket error for {session_id}: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
    finally:
        logger.info(f"=== WEBSOCKET CONNECTION ENDED for {session_id} ===")
        manager.disconnect(session_id)

@app.delete("/cleanup")
def cleanup_temp_files():
    """Clean up temporary files"""
    try:
        temp_files = []
        if os.path.exists(TEMP_DIR):
            for filename in os.listdir(TEMP_DIR):
                file_path = os.path.join(TEMP_DIR, filename)
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
    logger.info("Starting server with WebSocket support...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")