import cv2
from transformers import pipeline
from PIL import Image
import numpy as np
import logging

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
    """
    Process video to detect NSFW content and overlay classification results
    
    Args:
        input_path (str): Path to input video
        output_path (str): Path to output video
        frame_skip (int): Process every nth frame for efficiency
    """
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
    
    # Initialize video writer
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))
    
    if not out.isOpened():
        raise ValueError(f"Could not create output video file: {output_path}")
    
    frame_count = 0
    last_classification = {"label": "normal", "score": 0.0}
    
    try:
        while cap.isOpened():
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
                    # Continue with last known classification
            
            # Add overlay text with classification result
            label = last_classification["label"]
            score = last_classification["score"]
            
            # Prepare text and styling
            text = f"{label.upper()} ({score:.2f})"
            font = cv2.FONT_HERSHEY_SIMPLEX
            font_scale = 1.0
            thickness = 2
            
            # Choose color based on classification
            if label.lower() == "normal":
                color = (0, 255, 0)  # Green for normal
                bg_color = (0, 100, 0)  # Dark green background
            else:
                color = (0, 0, 255)  # Red for NSFW
                bg_color = (0, 0, 100)  # Dark red background
            
            # Get text size for background rectangle
            (text_width, text_height), baseline = cv2.getTextSize(text, font, font_scale, thickness)
            
            # Draw background rectangle
            cv2.rectangle(frame, 
                         (10, 10), 
                         (20 + text_width, 20 + text_height + baseline), 
                         bg_color, 
                         -1)
            
            # Draw text
            cv2.putText(frame, text, (15, 15 + text_height), font, font_scale, color, thickness)
            
            # Add progress indicator
            progress = (frame_count / total_frames) * 100
            progress_text = f"Progress: {progress:.1f}%"
            cv2.putText(frame, progress_text, (width - 200, height - 20), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
            
            # Write frame to output
            out.write(frame)
            frame_count += 1
            
            # Log progress every 100 frames
            if frame_count % 100 == 0:
                logger.info(f"Processed {frame_count}/{total_frames} frames ({progress:.1f}%)")
    
    except Exception as e:
        logger.error(f"Error during video processing: {e}")
        raise
    
    finally:
        # Clean up
        cap.release()
        out.release()
        cv2.destroyAllWindows()
    
    logger.info(f"Video processing completed: {output_path}")
    logger.info(f"Total frames processed: {frame_count}")

def test_classifier():
    """Test function to verify classifier is working"""
    try:
        # Create a simple test image
        test_image = Image.new('RGB', (224, 224), color='red')
        result = classifier(test_image)
        logger.info(f"Classifier test result: {result}")
        return True
    except Exception as e:
        logger.error(f"Classifier test failed: {e}")
        return False

if __name__ == "__main__":
    # Test the classifier
    if test_classifier():
        print("Classifier is working correctly!")
    else:
        print("Classifier test failed!")