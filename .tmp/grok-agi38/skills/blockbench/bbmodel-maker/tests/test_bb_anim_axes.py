#!/usr/bin/env python3
"""生成写关键帧时取反；渲染用文件里的度数，不再取反。"""

from __future__ import annotations

import unittest

import numpy as np

from bbmodel_maker.render.render_bbmodel import _rotmat
from bbmodel_maker.rig import bb_anim_axes as AX


class WriteNegatesRenderDoesNot(unittest.TestCase):
    def test_write_negates_every_axis(self) -> None:
        pitch = AX.rotation_to_bb({"pitch": 60.0}, "pitch")
        yaw = AX.rotation_to_bb({"yaw": 30.0}, "yaw")
        roll = AX.rotation_to_bb({"roll": 15.0}, "roll")
        self.assertEqual([-60.0, 0.0, 0.0], pitch)
        self.assertEqual([0.0, -30.0, 0.0], yaw)
        self.assertEqual([0.0, 0.0, -15.0], roll)

    def test_render_uses_the_file_degrees_without_another_negate(self) -> None:
        written = AX.rotation_to_bb({"pitch": 60.0}, "pitch")
        rendered = _rotmat(written[0], 0)
        self.assertTrue(np.allclose(rendered, _rotmat(-60.0, 0)))
        self.assertFalse(np.allclose(rendered, _rotmat(60.0, 0)))

    def test_read_back_is_not_the_inverse_of_write(self) -> None:
        written = AX.rotation_to_bb({"pitch": 60.0, "yaw": 30.0, "roll": 15.0}, "pitch")
        self.assertEqual(-60.0, written[0])
        self.assertAlmostEqual(60.0, AX.rotation_from_bb(written, "pitch"))
        self.assertEqual({"pitch": 60.0, "yaw": 0.0, "roll": 0.0}, AX.euler_to_mc(written))

    def test_static_group_uses_the_read_signs(self) -> None:
        self.assertEqual([-60.0, 30.0, -15.0],
                         AX.mc_to_euler({"pitch": 60.0, "yaw": 30.0, "roll": 15.0}))

    def test_position_write_negates_x_only_once(self) -> None:
        written = AX.body_position_to_bb({"x": 1.0, "y": 2.0, "z": 3.0})
        self.assertEqual([-16.0, -32.0, 48.0], written)
        self.assertEqual({"x": 1.0, "y": 2.0, "z": 3.0}, AX.body_position_from_bb(written))


if __name__ == "__main__":
    unittest.main()
