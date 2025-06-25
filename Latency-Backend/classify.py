import cv2
from transformers import pipeline
from PIL import Image
import numpy as np
import logging
import subprocess
import os

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize the classifier
try:
    classifier = pipeline("image-classification", model="perrytheplatypus/falconsai-finetuned-nsfw-detect")
    logger.info("NSFW classifier loaded successfully")
except Exception as e:
    logger.error(f"Failed to load classifier: {e}")
    raise

def process_video(input_path, output_path, frame_skip=30):
    """Process video to detect NSFW content and overlay classification results"""
    logger.info(f"Starting video processing: {input_path}")
    
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video file: {input_path}")
    
    # Get video properties
    fps = int(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    logger.info(f"Video properties - FPS: {fps}, Size: {width}x{height}, Total frames: {total_frames}")
    
    # Create temporary output path
    temp_output = output_path.replace('.mp4', '_temp.avi')
    
    # Try multiple codecs for OpenCV compatibility
    codecs_to_try = [
        ('avc1', '.mp4'),  # H.264
        ('XVID', '.avi'),  # XVID
        ('MJPG', '.avi'),  # Motion JPEG
        ('mp4v', '.mp4'),  # MPEG-4
    ]
    
    out = None
    for codec, ext in codecs_to_try:
        try:
            fourcc = cv2.VideoWriter_fourcc(*codec)
            test_path = temp_output.replace('.avi', ext)
            out = cv2.VideoWriter(test_path, fourcc, fps, (width, height))
            if out.isOpened():
                logger.info(f"Successfully opened video writer with codec: {codec}")
                temp_output = test_path
                break
            else:
                out.release()
        except Exception as e:
            logger.warning(f"Failed to use codec {codec}: {e}")
            continue
    
    if out is None or not out.isOpened():
        raise ValueError("Could not initialize video writer with any codec")
    
    frame_count = 0
    last_classification = {"label": "normal", "score": 0.0}
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Process classification every frame_skip frames
            if frame_count % frame_skip == 0:
                try:
                    # Convert BGR to RGB for PIL
                    rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    pil_image = Image.fromarray(rgb_frame)
                    
                    # Get classification
                    result = classifier(pil_image)[0]
                    last_classification = {
                        "label": result["label"],
                        "score": result["score"]
                    }
                    
                    logger.info(f"Frame {frame_count}: {last_classification['label']} ({last_classification['score']:.2f})")
                    
                except Exception as e:
                    logger.error(f"Error processing frame {frame_count}: {e}")
            
            # Add simple text overlay
            label = last_classification["label"]
            score = last_classification["score"]
            text = f"{label.upper()} ({score:.2f})"
            
            # Simple colored text
            color = (0, 255, 0) if label.lower() == "normal" else (0, 0, 255)
            cv2.putText(frame, text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, color, 2)
            
            # Write frame
            out.write(frame)
            frame_count += 1
            
            if frame_count % 100 == 0:
                progress = (frame_count / total_frames) * 100
                logger.info(f"Processed {frame_count}/{total_frames} frames ({progress:.1f}%)")
    
    finally:
        cap.release()
        out.release()
        cv2.destroyAllWindows()
    
    # Convert to web-compatible MP4 using ffmpeg if available
    try:
        if temp_output != output_path:
            convert_to_web_mp4(temp_output, output_path)
            # Clean up temporary file
            if os.path.exists(temp_output):
                os.remove(temp_output)
    except Exception as e:
        logger.warning(f"Failed to convert to web-compatible format: {e}")
        # If conversion fails, just use the original output
        if temp_output != output_path and os.path.exists(temp_output):
            os.rename(temp_output, output_path)
    
    logger.info(f"Video processing completed: {output_path}")

def convert_to_web_mp4(input_path, output_path):
    """Convert video to web-compatible MP4 using ffmpeg"""
    try:
        cmd = [
            'ffmpeg', '-i', input_path,
            '-c:v', 'libx264',  # H.264 video codec
            '-preset', 'fast',   # Encoding speed preset
            '-crf', '23',        # Quality (lower = better quality)
            '-c:a', 'aac',       # AAC audio codec
            '-movflags', '+faststart',  # Optimize for web streaming
            '-y',  # Overwrite output file
            output_path
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        
        if result.returncode == 0:
            logger.info("Successfully converted to web-compatible MP4")
        else:
            logger.error(f"ffmpeg conversion failed: {result.stderr}")
            raise Exception("ffmpeg conversion failed")
            
    except subprocess.TimeoutExpired:
        logger.error("ffmpeg conversion timed out")
        raise Exception("Video conversion timed out")
    except FileNotFoundError:
        logger.warning("ffmpeg not found, skipping conversion")
        raise Exception("ffmpeg not available")

def test_classifier():
    """Test function to verify classifier is working"""
    try:
        test_image = Image.new('RGB', (224, 224), color='red')
        result = classifier(test_image)
        logger.info(f"Classifier test result: {result}")
        return True
    except Exception as e:
        logger.error(f"Classifier test failed: {e}")
        return False

if __name__ == "__main__":
    if test_classifier():
        print("Classifier is working correctly!")
    else:
        print("Classifier test failed!")