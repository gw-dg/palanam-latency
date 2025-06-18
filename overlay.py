import cv2
import time
from classify import classify_chunk

video_path = "videos/video1.mp4"
cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS)
chunk_duration = 10
chunk_frames = int(chunk_duration * fps)
frame_buffer = []

flagged_classes = [45, 67, 123]  # Sample IDs — adjust later
current_prediction = None
last_check_time = time.time()

def is_flagged(cls, conf):
    return cls in flagged_classes and conf > 0.7

while True:
    ret, frame = cap.read()
    if not ret:
        break

    timestamp = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
    frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    frame_buffer.append(frame_rgb)

    if len(frame_buffer) > chunk_frames:
        frame_buffer.pop(0)

    if len(frame_buffer) == chunk_frames and time.time() - last_check_time > 2:
        cls, conf = classify_chunk(frame_buffer)
        print(f"Checked at {timestamp:.1f}s → Class {cls}, Conf {conf:.2f}")
        if is_flagged(cls, conf):
            print(f"⚠️ Flagged: Skipping 10 sec from {timestamp:.1f}s")
            cap.set(cv2.CAP_PROP_POS_MSEC, (timestamp + 10) * 1000)
            frame_buffer.clear()
        else:
            current_prediction = (cls, conf)
        last_check_time = time.time()

    # Overlay class label
    if current_prediction:
        cls, conf = current_prediction
        label = f"Class: {cls}, Conf: {conf:.2f}"
        cv2.putText(frame, label, (20, 40),
                    cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

    cv2.imshow("🛡️ Moderated Player", frame)
    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()
