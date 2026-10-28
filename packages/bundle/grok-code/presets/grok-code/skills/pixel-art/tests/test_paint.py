import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pixel_paint.paint import MATERIALS, dot, fill_rect, new_image, paint_face, paint_sheet, swatch_row


class PaintTest(unittest.TestCase):
    def test_size_is_whatever_the_caller_asks(self) -> None:
        image = new_image(3, 17)
        self.assertEqual(image.size, (3, 17))
        self.assertEqual(image.getpixel((0, 0))[3], 0)
        with self.assertRaises(ValueError):
            new_image(0, 4)

    def test_metal_is_not_a_flat_fill(self) -> None:
        image = swatch_row(("metal",), size=8)
        pixels = {image.getpixel((x, y)) for x in range(8) for y in range(8)}
        self.assertGreater(len(pixels), 1)

    def test_every_material_paints(self) -> None:
        image = swatch_row(MATERIALS, size=8)
        self.assertEqual(image.size, (8 * len(MATERIALS), 8))
        self.assertTrue(all(image.getpixel((i * 8 + 4, 4))[3] == 255 for i in range(len(MATERIALS))))

    def test_glow_adds_frames_and_flat_does_not(self) -> None:
        faces = [{"rect": (0, 0, 5, 2), "color": (200, 180, 40), "face": "north", "material": "glow"}]
        self.assertEqual(paint_sheet(7, 3, faces, frames=3).size, (7, 9))
        faces[0]["material"] = "wood"
        self.assertEqual(paint_sheet(7, 3, faces, frames=3).size, (7, 3))

    def test_paint_face_writes_inside_its_rect(self) -> None:
        image = new_image(6, 6)
        paint_face(image, (1, 1, 3, 3), (255, 0, 0), "up", "flat", bevel=False)
        self.assertEqual(image.getpixel((0, 0))[3], 0)
        self.assertEqual(image.getpixel((2, 2))[3], 255)

    def test_one_pixel_face_is_not_eaten_by_the_bevel(self) -> None:
        image = new_image(4, 1)
        paint_face(image, (1, 0, 1, 1), (10, 20, 30), "north", "flat")
        self.assertEqual(image.getpixel((1, 0)), (10, 20, 30, 255))
        self.assertEqual(image.getpixel((0, 0))[3], 0)

    def test_dot_and_fill_clip(self) -> None:
        image = new_image(4, 3)
        dot(image, -1, 0, (1, 2, 3))
        dot(image, 1, 1, (9, 8, 7))
        fill_rect(image, 2, -1, 4, 2, (4, 5, 6, 255))
        self.assertEqual(image.getpixel((1, 1)), (9, 8, 7, 255))
        self.assertEqual(image.getpixel((2, 0)), (4, 5, 6, 255))
        self.assertEqual(image.getpixel((3, 1))[3], 0)


if __name__ == "__main__":
    unittest.main()
