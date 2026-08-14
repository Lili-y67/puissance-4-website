from pathlib import Path
import argparse
from PIL import Image, ImageFilter


BADGES = Path(__file__).resolve().parents[1] / "src" / "public" / "badges"
FILES = ["VIP", "Crystal", "VIP_Plus", "Perso"]


def is_background(pixel):
    red, green, blue = pixel
    brightness = (red + green + blue) / 3
    spread = max(pixel) - min(pixel)
    return brightness >= 236 and spread <= 10


def remove_checkerboard(source: Path, destination: Path):
    image = Image.open(source).convert("RGB")
    width, height = image.size
    pixels = image.load()
    background = Image.new("L", image.size, 0)
    background_pixels = background.load()

    # The generated checkerboard consists of near-white, neutral grey tiles.
    # Removing those neutral pixels globally also clears enclosed ribbon loops.
    for y in range(height):
        for x in range(width):
            if is_background(pixels[x, y]):
                background_pixels[x, y] = 255

    # Slight expansion catches the anti-aliased checkerboard edge, then a tiny
    # blur restores a smooth product contour instead of a hard pixel staircase.
    background = background.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.55))
    alpha = background.point(lambda value: 255 - value)

    rgba = image.convert("RGBA")
    rgba.putalpha(alpha)
    rgba.save(destination, "PNG", optimize=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Retire un fond damier clair et cree un PNG transparent.")
    parser.add_argument("source", nargs="?")
    parser.add_argument("destination", nargs="?")
    args = parser.parse_args()
    if args.source and args.destination:
        destination = Path(args.destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        remove_checkerboard(Path(args.source), destination)
        result = Image.open(destination)
        print(f"{destination.name}: {result.size[0]}x{result.size[1]}, alpha={result.getchannel('A').getextrema()}")
    else:
        for name in FILES:
            remove_checkerboard(BADGES / f"{name}-cutout.png", BADGES / f"{name}-transparent.png")
            result = Image.open(BADGES / f"{name}-transparent.png")
            extrema = result.getchannel("A").getextrema()
            print(f"{name}: {result.size[0]}x{result.size[1]}, alpha={extrema}")
