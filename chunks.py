import cv2
import os

def get_video_chunks(path, chunk_duration=10, overlap=2, frame_size=(112, 112), target_fps=10):
    cap = cv2.VideoCapture(path)
    original_fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"original_fps : {original_fps}, total_frames : {total_frames}")

    frame_interval = int(original_fps / target_fps)
    chunk_frame_count = int(chunk_duration * target_fps)
    step_frame_count = int((chunk_duration - overlap) * target_fps)

    chunks = []
    start_frame = 0

    while start_frame + chunk_frame_count * frame_interval <= total_frames:
        frames = []
        for i in range(chunk_frame_count):
            frame_idx = start_frame + i * frame_interval
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                break
            frame = cv2.resize(frame, frame_size)
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            frames.append(frame)

        if len(frames) == chunk_frame_count:
            chunks.append(frames)

        start_frame += step_frame_count * frame_interval

    cap.release()
    return chunks, target_fps


# === TESTING ===
input_video = 'videos/video1.mp4'
output_dir = 'chunk_test'

chunks, fps = get_video_chunks(input_video)

if not os.path.exists(output_dir):
    os.makedirs(output_dir)

for i, chunk in enumerate(chunks):
    out_path = os.path.join(output_dir, f'chunk_{i+1}.mp4')
    out = cv2.VideoWriter(out_path,
                          cv2.VideoWriter_fourcc(*'mp4v'),
                          fps,
                          (112, 112))

    for frame in chunk:
        frame_bgr = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
        out.write(frame_bgr)

    out.release()

print(f"Saved {len(chunks)} chunks to '{output_dir}' at {fps} FPS.")
