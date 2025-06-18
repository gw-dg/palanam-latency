import cv2
import os

vid = cv2.VideoCapture('videos/video1.mp4')
currentframe = 0

# Get original video FPS
original_fps = vid.get(cv2.CAP_PROP_FPS)

# Calculate frame skip interval
frame_interval = int(original_fps / 10)

if not os.path.exists('data'):
    os.makedirs('data')

frame_count = 0

while True:
    success, frame = vid.read()
    if not success:
        break

    if frame_count % frame_interval == 0:
        cv2.imshow("Output", frame)
        cv2.imwrite(f'./data/frame{currentframe}.jpg', frame)
        currentframe += 1

    frame_count += 1

    if cv2.waitKey(1) & 0xFF == ord('d'):
        break

vid.release()
cv2.destroyAllWindows()
