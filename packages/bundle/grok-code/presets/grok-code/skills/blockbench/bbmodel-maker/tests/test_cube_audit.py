"""通用方块检查与材质贴图。不依赖任何项目里的 .bbmodel。"""

from __future__ import annotations

import unittest

from bbmodel_maker.model.cube_audit import (
    bone_cycles, box_uv_rects, box_uv_size, coplanar_faces, disconnected,
    uv_density, uv_outside, uv_overlaps,
)
from bbmodel_maker.model.material_paint import paint_face, paint_sheet, swatch_row


def _cube(name, frm, to, uv, box=True):
    el = {"name": name, "type": "cube", "from": list(frm), "to": list(to), "box_uv": box}
    if box:
        el["uv_offset"] = list(uv)
    else:
        el["faces"] = {"north": {"uv": list(uv)}}
    return el


class BoxUvTest(unittest.TestCase):
    def test_unfold_size_matches_the_cross(self) -> None:
        self.assertEqual(box_uv_size((4, 6, 2)), (2 * 2 + 2 * 4, 2 + 6))

    def test_six_faces_cover_that_rectangle(self) -> None:
        rects = box_uv_rects((0, 0), (4, 6, 2))
        self.assertEqual(set(rects), {"up", "down", "east", "north", "west", "south"})
        w, h = box_uv_size((4, 6, 2))
        self.assertTrue(all(0 <= x and x + rw <= w and 0 <= y and y + rh <= h
                            for x, y, rw, rh in rects.values()))


class UvOverlapTest(unittest.TestCase):
    def test_disjoint_offsets_pass(self) -> None:
        model = {"elements": [
            _cube("a", (0, 0, 0), (2, 2, 2), (0, 0)),
            _cube("b", (2, 0, 0), (4, 2, 2), (20, 0)),
        ]}
        self.assertEqual(uv_overlaps(model), [])

    def test_shared_offset_is_named(self) -> None:
        model = {"elements": [
            _cube("a", (0, 0, 0), (2, 2, 2), (0, 0)),
            _cube("b", (2, 0, 0), (4, 2, 2), (0, 0)),
        ]}
        found = uv_overlaps(model)
        self.assertEqual(len(found), 6)
        self.assertTrue(all("a." in line and "b." in line for line in found))

    def test_a_face_in_another_unfold_gap_passes(self) -> None:
        # 4x2x2 的展开十字里，up 占 x 2..6，down 占 x 6..10。
        # mark 的 1x1 落在这两块之间，旧的外接矩形检查会误报。
        gap = _cube("mark", (0, 0, 0), (1, 1, 1), (6, 1), box=False)
        body = _cube("body", (0, 0, 0), (4, 2, 2), (0, 0))
        self.assertEqual(uv_overlaps({"elements": [body, gap]}), [])

    def test_a_face_past_the_texture_is_named(self) -> None:
        model = {
            "resolution": {"width": 8, "height": 8},
            "elements": [{
                "name": "a", "type": "cube", "box_uv": False,
                "from": [0, 0, 0], "to": [2, 1, 1],
                "faces": {"north": {"uv": [7, 0, 9, 1]}},
            }],
        }
        found = uv_outside(model)
        self.assertEqual(len(found), 1)
        self.assertIn("a.north", found[0])


class ConnectivityTest(unittest.TestCase):
    def test_touching_cubes_are_one_piece(self) -> None:
        model = {"elements": [
            _cube("a", (0, 0, 0), (2, 2, 2), (0, 0)),
            _cube("b", (2, 0, 0), (4, 2, 2), (20, 0)),
        ]}
        self.assertEqual(disconnected(model), [])

    def test_a_gap_is_reported_and_a_named_float_is_allowed(self) -> None:
        model = {"elements": [
            _cube("body", (0, 0, 0), (4, 4, 4), (0, 0)),
            _cube("halo", (0, 8, 0), (2, 9, 2), (30, 0)),
        ]}
        self.assertTrue(disconnected(model))
        self.assertEqual(disconnected(model, detached=["halo"]), [])


class BoneCycleTest(unittest.TestCase):
    def test_a_loop_is_named(self) -> None:
        model = {"outliner": [{
            "name": "a",
            "children": [{"name": "b", "children": [{"name": "a", "children": []}]}],
        }]}
        found = bone_cycles(model)
        self.assertEqual(len(found), 1)
        self.assertIn("a -> b -> a", found[0])

    def test_a_tree_passes(self) -> None:
        model = {"outliner": [{"name": "root", "children": [{"name": "arm", "children": []}]}]}
        self.assertEqual(bone_cycles(model), [])


class DensityTest(unittest.TestCase):
    def _face(self, uv):
        return {"elements": [{
            "name": "panel", "from": [0, 0, 0], "to": [4, 2, 1],
            "faces": {"north": {"uv": list(uv)}},
        }]}

    def test_even_density_passes(self) -> None:
        self.assertEqual(uv_density(self._face((0, 0, 4, 2))), [])

    def test_stretched_v_is_named(self) -> None:
        found = uv_density(self._face((0, 0, 4, 8)))
        self.assertEqual(len(found), 1)
        self.assertIn("panel.north", found[0])


class CoplanarTest(unittest.TestCase):
    def test_offset_faces_pass(self) -> None:
        model = {"elements": [
            _cube("a", (0, 0, 0), (2, 2, 2), (0, 0)),
            _cube("b", (0, 0, 2.1), (2, 2, 4), (20, 0)),
        ]}
        self.assertEqual(coplanar_faces(model), [])

    def test_shared_outer_face_is_named(self) -> None:
        model = {"elements": [
            _cube("a", (0, 0, 0), (2, 2, 2), (0, 0)),
            _cube("b", (0, 0, 1), (2, 2, 3), (20, 0)),
        ]}
        found = coplanar_faces(model)
        self.assertTrue(any("a" in line and "b" in line for line in found))


class MaterialPaintTest(unittest.TestCase):
    def test_metal_is_not_a_flat_fill(self) -> None:
        image = swatch_row(("metal",), size=8)
        pixels = {image.getpixel((x, y)) for x in range(8) for y in range(8)}
        self.assertGreater(len(pixels), 1)

    def test_glow_adds_frames_and_flat_does_not(self) -> None:
        faces = [{"rect": (0, 0, 4, 4), "color": (200, 200, 200), "face": "north", "material": "glow"}]
        self.assertEqual(paint_sheet(4, 4, faces, frames=3).size, (4, 12))
        faces[0]["material"] = "wood"
        self.assertEqual(paint_sheet(4, 4, faces, frames=3).size, (4, 4))

    def test_paint_face_writes_inside_its_rect(self) -> None:
        from PIL import Image
        image = Image.new("RGBA", (6, 6), (0, 0, 0, 0))
        paint_face(image, (1, 1, 3, 3), (255, 0, 0), "up", "flat", bevel=False)
        self.assertEqual(image.getpixel((0, 0))[3], 0)
        self.assertEqual(image.getpixel((2, 2))[3], 255)


class UnfoldTest(unittest.TestCase):
    def test_unfold_writes_one_pixel_per_unit(self) -> None:
        from bbmodel_maker.rig.voxel_rig import Palette, Rig

        rig = Rig(Palette({"stone": (140, 140, 140)}))
        rig.bone("body", (0, 0, 0))
        el = rig.cube("body", "slab", (0, 0, 0), (4, 2, 1), mat="stone")
        rects = rig.unfold(el, 3, 5)
        self.assertEqual(rects["north"], (4, 6, 4, 2))
        self.assertEqual(el["faces"]["north"]["uv"], [4.0, 6.0, 8.0, 8.0])
        self.assertFalse(el["box_uv"])

    def test_fractional_edges_share_one_rounding(self) -> None:
        from bbmodel_maker.model.cube_audit import uv_density
        from bbmodel_maker.rig.voxel_rig import Palette, Rig

        rig = Rig(Palette({"steel": (90, 90, 96)}))
        rig.bone("body", (0, 0, 0))
        el = rig.cube("body", "knob", (0, 0, 0), (0.8, 1.9, 1.5), mat="steel")
        rig.unfold(el, 0, 0)
        # 0.8 和 1.5 都收到 1 或都收到 2。一边 1、一边 2 时密度比是 2.5 倍。
        self.assertEqual(el["faces"]["north"]["uv"], [2.0, 2.0, 3.0, 4.0])
        self.assertEqual(
            uv_density({"elements": [el], "resolution": {"width": 16, "height": 16}}), [],
        )

    def test_material_name_survives_eight_slots_and_leaves_the_file(self) -> None:
        from bbmodel_maker.rig.voxel_rig import Palette, Rig

        colors = {f"m{i}": (i, 0, 0) for i in range(10)}
        rig = Rig(Palette(colors, size=64))
        rig.bone("body", (0, 0, 0))
        for i in range(10):
            rig.cube("body", f"c{i}", (i, 0, 0), (i + 1, 1, 1), mat=f"m{i}")
        self.assertEqual(rig.elements[8]["_mat"], "m8")
        self.assertEqual(rig.elements[8]["color"], rig.elements[0]["color"])
        written = rig.bbmodel("ten")
        self.assertTrue(all("_mat" not in el for el in written["elements"]))

    def test_paint_uses_the_material_name_not_the_color_slot(self) -> None:
        from bbmodel_maker.rig.voxel_rig import Palette, Rig

        rig = Rig(Palette({"bolt": (200, 40, 40), "wood": (140, 90, 40)}, size=64))
        rig.bone("body", (0, 0, 0))
        rig.cube("body", "pin", (0, 0, 0), (2, 2, 2), mat="bolt")
        sheet = rig.paint(lambda name: "metal" if name == "bolt" else "flat")
        self.assertEqual(sheet.size, (64, 64))
        self.assertEqual(sheet.getpixel((1, 3))[3], 255)
        self.assertNotIn("_mat", rig.bbmodel("painted")["elements"][0])


if __name__ == "__main__":
    unittest.main()
