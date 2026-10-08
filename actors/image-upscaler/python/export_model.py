"""Docker build only: download the Real-ESRGAN realesr-general-x4v3 weights
(BSD-3-Clause, SHA-256 pinned), export them to ONNX and check that ONNX
Runtime reproduces PyTorch's output.

Usage: python export_model.py <out.onnx>
Needs torch (CPU build) and onnxruntime; neither torch nor this script is in
the final image.
"""

import hashlib
import os
import sys
import urllib.request

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

WEIGHTS_URL = (
    "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/"
    "realesr-general-x4v3.pth"
)
WEIGHTS_SHA256 = "8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292"


class SRVGGNetCompact(nn.Module):
    """Real-ESRGAN's compact network (realesrgan/archs/srvgg_arch.py), with
    the hyperparameters of realesr-general-x4v3."""

    def __init__(self, num_feat=64, num_conv=32, upscale=4):
        super().__init__()
        self.upscale = upscale
        self.body = nn.ModuleList()
        self.body.append(nn.Conv2d(3, num_feat, 3, 1, 1))
        self.body.append(nn.PReLU(num_parameters=num_feat))
        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            self.body.append(nn.PReLU(num_parameters=num_feat))
        self.body.append(nn.Conv2d(num_feat, 3 * upscale * upscale, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for layer in self.body:
            out = layer(out)
        out = self.upsampler(out)
        return out + F.interpolate(x, scale_factor=self.upscale, mode="nearest")


def main(out_path):
    weights = urllib.request.urlopen(WEIGHTS_URL, timeout=300).read()
    digest = hashlib.sha256(weights).hexdigest()
    if digest != WEIGHTS_SHA256:
        sys.exit(f"weights SHA-256 mismatch: {digest}")
    pth = out_path + ".pth"
    with open(pth, "wb") as f:
        f.write(weights)
    state = torch.load(pth, map_location="cpu", weights_only=True)["params"]
    os.remove(pth)
    net = SRVGGNetCompact()
    net.load_state_dict(state, strict=True)
    net.eval()
    torch.onnx.export(
        net,
        torch.rand(1, 3, 64, 64),
        out_path,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {2: "h", 3: "w"}, "output": {2: "H", 3: "W"}},
        opset_version=17,
        dynamo=False,
    )

    import onnxruntime as ort

    x = torch.rand(1, 3, 37, 53)
    with torch.no_grad():
        want = net(x).numpy()
    sess = ort.InferenceSession(out_path, providers=["CPUExecutionProvider"])
    got = sess.run(None, {"input": x.numpy()})[0]
    diff = float(np.abs(want - got).max())
    if got.shape != (1, 3, 148, 212) or diff > 1e-3:
        sys.exit(f"ONNX export mismatch: shape {got.shape}, max diff {diff}")
    print(f"exported {out_path} (max diff vs PyTorch {diff:.2e})", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
