import torch
import torchvision
from torchvision.transforms import Normalize
import numpy as np

# Load model
from torchvision.models.video import mc3_18, MC3_18_Weights
weights = MC3_18_Weights.DEFAULT
model = mc3_18(weights=weights)
model.eval()

# Transform params
mean = torch.tensor(weights.meta["mean"])
std = torch.tensor(weights.meta["std"])

def classify_chunk(frames):
    # frames = list of [H, W, C] numpy arrays
    clip = np.stack(frames, axis=0)              # [T, H, W, C]
    clip = torch.from_numpy(clip).permute(3, 0, 1, 2)  # [C, T, H, W]
    clip = clip.float() / 255.0                   # Normalize to 0-1
    clip = (clip - mean[:, None, None, None]) / std[:, None, None, None]  # Manual Normalize
    clip = clip.unsqueeze(0)                      # [1, C, T, H, W]

    with torch.no_grad():
        out = model(clip)
        probs = torch.nn.functional.softmax(out, dim=1)
        top_prob, top_class = probs[0].max(0)
        return int(top_class), float(top_prob)
