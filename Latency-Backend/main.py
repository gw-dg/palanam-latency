from fastapi import FastAPI, File, UploadFile, HTTPException, WebSocket, WebSocketDisconnect, Body
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
from transformers.pipelines import pipeline
from PIL import Image
import numpy as np
import time
import subprocess

# Add this import for YouTube download support
try:
    from pytube import YouTube, exceptions as pytube_exceptions
except ImportError:
    YouTube = None
    pytube_exceptions = None

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

@app.post("/process-youtube/")
async def process_youtube_video(data: dict = Body(...)):
    """Download a YouTube video using yt-dlp, save it, and return a session ID with improved error handling. Supports optional 'cookies' in POST body for authenticated downloads."""
    url = data.get("url")
    cookies = data.get("cookies")  # Optional: string (Netscape or JSON format)
    if not url:
        raise HTTPException(status_code=400, detail="YouTube URL is required.")

    # Validate URL format
    if not (url.startswith("https://www.youtube.com/watch?v=") or 
            url.startswith("https://youtu.be/") or
            url.startswith("https://youtube.com/watch?v=") or
            url.startswith("https://m.youtube.com/watch?v=")):
        raise HTTPException(
            status_code=400, 
            detail="Invalid YouTube URL format. Please use a valid YouTube video URL."
        )

    session_id = str(uuid.uuid4())
    filename = f"video_{session_id}.mp4"
    file_path = os.path.join(TEMP_DIR, filename)
    cookies_path = None

    try:
        logger.info(f"=== YOUTUBE PROCESSING STARTED ===")
        logger.info(f"URL: {url}")
        logger.info(f"Session ID: {session_id}")

        # If cookies provided, save to a temp file
        if cookies:
            cookies_path = os.path.join(TEMP_DIR, f"cookies_{session_id}.txt")
            with open(cookies_path, "w", encoding="utf-8") as f:
                f.write(cookies)
            logger.info(f"Saved cookies to {cookies_path}")

        # yt-dlp command to download best mp4 under 10 minutes and 100MB
        ytdlp_cmd = [
            "yt-dlp",
            "--no-playlist",
            "--max-filesize", "100M",
            "--match-filter", "duration < 600",
            "-f", "best[ext=mp4]",
            "-o", file_path,
            url
        ]
        if cookies_path:
            ytdlp_cmd.extend(["--cookies", cookies_path])
        logger.info(f"Running yt-dlp: {' '.join(ytdlp_cmd)}")
        result = subprocess.run(ytdlp_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error(f"yt-dlp failed: {result.stderr}")
            raise HTTPException(status_code=400, detail=f"yt-dlp error: {result.stderr}")

        # If file does not exist, try to find the downloaded file (yt-dlp may add extension)
        if not os.path.exists(file_path):
            candidates = [f for f in os.listdir(TEMP_DIR) if f.startswith(f"video_{session_id}")]
            if candidates:
                file_path = os.path.join(TEMP_DIR, candidates[0])
            else:
                raise HTTPException(status_code=500, detail="yt-dlp did not produce a video file.")

        # Optionally, convert to mp4 using ffmpeg if not already mp4
        if not file_path.endswith(".mp4"):
            mp4_path = os.path.join(TEMP_DIR, f"video_{session_id}.mp4")
            ffmpeg_cmd = [
                "ffmpeg", "-y", "-i", file_path, "-c:v", "copy", "-c:a", "aac", mp4_path
            ]
            logger.info(f"Converting to mp4: {' '.join(ffmpeg_cmd)}")
            ffmpeg_result = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
            if ffmpeg_result.returncode != 0:
                logger.error(f"ffmpeg failed: {ffmpeg_result.stderr}")
                raise HTTPException(status_code=500, detail=f"ffmpeg error: {ffmpeg_result.stderr}")
            os.remove(file_path)
            file_path = mp4_path

        actual_file_size = os.path.getsize(file_path)
        if actual_file_size > 100 * 1024 * 1024:
            os.remove(file_path)
            raise HTTPException(
                status_code=400, 
                detail="Downloaded file is too large. Maximum size is 100MB."
            )

        # Verify video file integrity with OpenCV
        try:
            test_cap = cv2.VideoCapture(file_path)
            if not test_cap.isOpened():
                test_cap.release()
                os.remove(file_path)
                raise Exception("Downloaded video file is corrupted or not readable")
            ret, frame = test_cap.read()
            test_cap.release()
            if not ret:
                os.remove(file_path)
                raise Exception("Downloaded video file has no readable frames")
        except Exception as e:
            logger.error(f"Video integrity check failed: {e}")
            if os.path.exists(file_path):
                os.remove(file_path)
            raise HTTPException(status_code=500, detail="Downloaded video file is corrupted")

        logger.info(f"=== YOUTUBE PROCESSING COMPLETED ===")

        return {
            "session_id": session_id,
            "filename": filename,
            "file_size_mb": round(actual_file_size / (1024 * 1024), 2),
            "message": "YouTube video downloaded and verified successfully. Connect to WebSocket for real-time processing."
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"YouTube processing failed: {str(e)}")
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                logger.info(f"Cleaned up failed download: {file_path}")
            except:
                pass
        raise HTTPException(status_code=500, detail=f"YouTube processing error: {str(e)}")
    finally:
        # Clean up cookies file if used
        if cookies_path and os.path.exists(cookies_path):
            try:
                os.remove(cookies_path)
                logger.info(f"Deleted cookies file: {cookies_path}")
            except Exception as e:
                logger.warning(f"Failed to delete cookies file: {cookies_path} ({e})")

@app.get("/get-video/{session_id}")
async def get_video(session_id: str):
    """Serve the downloaded video file for a given session"""
    try:
        # Find the video file for this session
        video_files = [f for f in os.listdir(TEMP_DIR) if f.startswith(f"video_{session_id}")]
        
        if not video_files:
            raise HTTPException(
                status_code=404, 
                detail=f"Video not found for session {session_id}"
            )
        
        video_path = os.path.join(TEMP_DIR, video_files[0])
        
        if not os.path.exists(video_path):
            raise HTTPException(
                status_code=404, 
                detail=f"Video file not found: {video_files[0]}"
            )
        
        # Return the video file
        return FileResponse(
            path=video_path,
            media_type="video/mp4",
            filename=f"video_{session_id}.mp4",
            headers={
                "Accept-Ranges": "bytes",
                "Content-Disposition": f"inline; filename=video_{session_id}.mp4"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving video for session {session_id}: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Error serving video: {str(e)}"
        )

@app.get("/video-info/{session_id}")
async def get_video_info(session_id: str):
    """Get information about a video for a given session"""
    try:
        if session_id not in manager.video_info:
            raise HTTPException(
                status_code=404, 
                detail=f"Video info not found for session {session_id}"
            )
        
        return {
            "session_id": session_id,
            "video_info": manager.video_info[session_id],
            "has_video_file": session_id in manager.video_paths,
            "is_processing": session_id in manager.processing_tasks
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting video info for session {session_id}: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Error getting video info: {str(e)}"
        )

# Add a route to check session status
@app.get("/session-status/{session_id}")
async def get_session_status(session_id: str):
    """Get the current status of a session"""
    try:
        # Check if video file exists
        video_files = [f for f in os.listdir(TEMP_DIR) if f.startswith(f"video_{session_id}")]
        has_video = len(video_files) > 0
        
        # Check if session is active
        is_connected = session_id in manager.active_connections
        has_video_info = session_id in manager.video_info
        is_processing = session_id in manager.processing_tasks
        
        status = {
            "session_id": session_id,
            "has_video_file": has_video,
            "is_connected": is_connected,
            "has_video_info": has_video_info,
            "is_processing": is_processing,
            "video_files": video_files
        }
        
        if has_video_info:
            status["video_info"] = manager.video_info[session_id]
        
        return status
        
    except Exception as e:
        logger.error(f"Error getting session status for {session_id}: {e}")
        raise HTTPException(
            status_code=500, 
            detail=f"Error getting session status: {str(e)}"
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

# Add these debug endpoints to your FastAPI app

@app.get("/debug/sessions")
async def debug_sessions():
    """Debug endpoint to see all active sessions"""
    try:
        temp_files = []
        if os.path.exists(TEMP_DIR):
            temp_files = [f for f in os.listdir(TEMP_DIR) if f.startswith("video_")]
        
        return {
            "active_connections": list(manager.active_connections.keys()),
            "video_captures": list(manager.video_captures.keys()),
            "video_info": {k: v for k, v in manager.video_info.items()},
            "processing_tasks": list(manager.processing_tasks.keys()),
            "video_paths": {k: v for k, v in manager.video_paths.items()},
            "temp_files": temp_files,
            "temp_dir": TEMP_DIR,
            "classifier_loaded": classifier is not None
        }
    except Exception as e:
        return {"error": str(e)}

@app.get("/debug/test-youtube")
async def test_youtube_availability():
    """Test if YouTube processing is available"""
    try:
        # yt-dlp is now a subprocess, so we just check if it's installed
        try:
            subprocess.run(["yt-dlp", "--version"], capture_output=True, text=True)
            return {
                "available": True,
                "message": "yt-dlp is installed and available for testing."
            }
        except FileNotFoundError:
            return {
                "available": False,
                "error": "yt-dlp not found. Please install it: pip install yt-dlp",
                "suggestion": "Install yt-dlp with: pip install yt-dlp"
            }
        except Exception as e:
            return {
                "available": False,
                "error": f"yt-dlp test failed: {str(e)}",
                "suggestion": "Check internet connection and yt-dlp installation"
            }
    except Exception as e:
        return {
            "available": False,
            "error": str(e)
        }

@app.post("/debug/test-classification")
async def test_classification():
    """Test if the classification model is working"""
    try:
        if classifier is None:
            return {
                "working": False,
                "error": "Classifier not loaded",
                "suggestion": "Check if the model 'perrytheplatypus/falconsai-finetuned-nsfw-detect' is available"
            }
        
        # Create a test image
        from PIL import Image
        import numpy as np
        
        # Create a simple test image (100x100 blue square)
        test_image = Image.new('RGB', (100, 100), color='blue')
        
        # Test classification
        result = classifier(test_image)
        
        return {
            "working": True,
            "test_result": result,
            "model_loaded": True
        }
        
    except Exception as e:
        return {
            "working": False,
            "error": str(e),
            "suggestion": "Check transformers and model installation"
        }

# Add logging configuration helper
def setup_enhanced_logging():
    """Setup enhanced logging for better debugging"""
    import logging
    
    # Create formatters
    detailed_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s'
    )
    
    # Setup file handler
    file_handler = logging.FileHandler('video_classifier.log')
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(detailed_formatter)
    
    # Setup console handler
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(detailed_formatter)
    
    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG)
    root_logger.addHandler(file_handler)
    root_logger.addHandler(console_handler)
    
    # Also setup specific loggers
    for logger_name in ['uvicorn', 'fastapi', '__main__']:
        logger = logging.getLogger(logger_name)
        logger.setLevel(logging.DEBUG)

# Common troubleshooting steps
TROUBLESHOOTING_STEPS = {
    "youtube_download_fails": [
        "Check internet connection",
        "Verify YouTube URL format",
        "Ensure video is not private/age-restricted",
        "Try a different video",
        "Check if yt-dlp is installed: pip install yt-dlp",
        "Update yt-dlp: pip install --upgrade yt-dlp"
    ],
    "classification_fails": [
        "Check if transformers is installed: pip install transformers torch",
        "Verify model name: perrytheplatypus/falconsai-finetuned-nsfw-detect",
        "Check internet connection for model download",
        "Try restarting the server",
        "Check available disk space"
    ],
    "websocket_connection_fails": [
        "Check if server is running on correct port (8000)",
        "Verify CORS settings include your frontend origin",
        "Check browser developer tools for WebSocket errors",
        "Try refreshing the page",
        "Check server logs for connection errors"
    ],
    "video_processing_slow": [
        "Reduce video resolution/quality",
        "Use shorter videos (< 5 minutes)",
        "Check CPU/GPU usage",
        "Reduce classification frequency",
        "Close other applications"
    ]
}

@app.get("/debug/troubleshooting")
async def get_troubleshooting_guide():
    """Get troubleshooting guide"""
    return {
        "troubleshooting_steps": TROUBLESHOOTING_STEPS,
        "common_errors": {
            "yt_dlp_not_installed": "Install with: pip install yt-dlp",
            "transformers_not_installed": "Install with: pip install transformers torch",
            "opencv_not_installed": "Install with: pip install opencv-python",
            "video_too_large": "Use videos smaller than 100MB",
            "unsupported_format": "Use MP4, AVI, MOV, or WebM formats"
        },
        "system_requirements": {
            "python": "3.8+",
            "required_packages": [
                "fastapi",
                "uvicorn",
                "transformers",
                "torch",
                "opencv-python",
                "yt-dlp",
                "pillow",
                "numpy"
            ]
        }
    }

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