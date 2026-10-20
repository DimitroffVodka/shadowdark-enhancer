"""
Shadowdark Enhancer: the landing page's table, built and rendered in Blender (the module's own art).

    nice -n 19 blender --background --factory-startup --python tools/landing-table/build_table.py

A candle-lit wooden table seen from a seat at it, with the props that are the page's buttons: the quest tome, the
coin chest, the dice cup, the tankard, the framed map, the sealed letter, the hourglass, the journal, the session
title card and the day dial. Writes to tools/landing-table/out/:

    beauty.png        the table as it rests (chest closed)
    ids.png           every prop in its own flat colour, for the per-prop masks
    beauty-open.png   the same with the chest open (for its opening)
    ids-open.png      its masks
    projection.json   where the overlay quads (tome pages, title card, dial) and the party's seats land, in pixels

make_assets.py turns those into the module's assets. Everything is procedural: no textures, nothing imported.
"""
import json
import math
import os

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)
W, H = 2560, 1440

# The flat colour each prop gets in ids.png (make_assets.py reads the same table).
PROPS = ["quests", "market", "games", "carouse", "map", "rumors", "downtime", "journals", "title", "dial"]
ID_COLOURS = {p: c for p, c in zip(PROPS, [
    (1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 0), (1, 0, 1), (0, 1, 1), (1, .5, 0), (.5, 0, 1), (0, .5, 1), (1, 0, .5),
])}

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = W, H, 100
scene.eevee.taa_render_samples = 64
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.view_settings.exposure = 0.0
# LT_PREVIEW=1: a small, quick render of the table only, for framing.
PREVIEW = bool(os.environ.get("LT_PREVIEW"))
if PREVIEW:
    scene.render.resolution_percentage, scene.eevee.taa_render_samples = 40, 16


# ── materials ────────────────────────────────────────────────────────────────────────────────────────────────────

def material(name, build):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    build(nt, bsdf)
    return mat


def flat(name, colour, rough=0.6, metal=0.0, emit=None, strength=0.0):
    def build(nt, b):
        b.inputs["Base Color"].default_value = (*colour, 1)
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
        if emit:
            b.inputs["Emission Color"].default_value = (*emit, 1)
            b.inputs["Emission Strength"].default_value = strength
    return material(name, build)


def noisy(name, dark, light, scale=8.0, rough=0.55, metal=0.0, detail=6.0, bump=0.15, stretch=None, grain=None):
    """A colour ramp over noise (wood waves when `stretch`, long grain when `grain` squeezes it), with a little bump from the same pattern."""
    def build(nt, b):
        n = nt.nodes
        coord = n.new("ShaderNodeTexCoord")
        mapping = n.new("ShaderNodeMapping")
        nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
        if grain:
            mapping.inputs["Scale"].default_value = grain
        if stretch:
            mapping.inputs["Scale"].default_value = stretch
            tex = n.new("ShaderNodeTexWave")
            tex.inputs["Scale"].default_value = scale
            tex.inputs["Distortion"].default_value = 6.0
            tex.inputs["Detail"].default_value = detail
            out = tex.outputs["Fac"]
        else:
            tex = n.new("ShaderNodeTexNoise")
            tex.inputs["Scale"].default_value = scale
            tex.inputs["Detail"].default_value = detail
            out = tex.outputs["Fac"]
        nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
        ramp = n.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*dark, 1)
        ramp.color_ramp.elements[1].color = (*light, 1)
        nt.links.new(out, ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
        bmp = n.new("ShaderNodeBump")
        bmp.inputs["Strength"].default_value = bump
        nt.links.new(out, bmp.inputs["Height"])
        nt.links.new(bmp.outputs["Normal"], b.inputs["Normal"])
    return material(name, build)


def map_paper():
    """Parchment with land in sepia ink: noise thresholded into coastlines, a second noise for its stains."""
    def build(nt, b):
        n = nt.nodes
        coord = n.new("ShaderNodeTexCoord")
        land = n.new("ShaderNodeTexNoise")
        land.inputs["Scale"].default_value = 3.2
        land.inputs["Detail"].default_value = 8.0
        nt.links.new(coord.outputs["Object"], land.inputs["Vector"])
        ramp = n.new("ShaderNodeValToRGB")
        ramp.color_ramp.interpolation = "CONSTANT"
        e = ramp.color_ramp.elements
        e[0].position, e[0].color = 0.0, (0.55, 0.55, 0.47, 1)       # sea
        e[1].position, e[1].color = 0.50, (0.12, 0.07, 0.03, 1)      # the ink coastline
        mid = e.new(0.525)
        mid.color = (0.78, 0.64, 0.40, 1)                             # land
        nt.links.new(land.outputs["Fac"], ramp.inputs["Fac"])
        b.inputs["Roughness"].default_value = 0.8
        nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return material("MapPaper", build)


M = {
    "wood": noisy("TableWood", (0.04, 0.016, 0.006), (0.30, 0.15, 0.06), scale=4.0, detail=9.0, grain=(0.22, 16, 1), bump=0.35),
    "darkwood": noisy("DarkWood", (0.04, 0.02, 0.01), (0.14, 0.07, 0.03), scale=3, stretch=(1, 6, 1)),
    "wall": noisy("Wall", (0.015, 0.012, 0.01), (0.05, 0.035, 0.025), scale=4, bump=0.4),
    "leather": noisy("Leather", (0.12, 0.03, 0.02), (0.30, 0.09, 0.05), scale=40, rough=0.55),
    "green": noisy("GreenLeather", (0.02, 0.06, 0.04), (0.06, 0.16, 0.10), scale=40, rough=0.5),
    "paper": noisy("Parchment", (0.62, 0.50, 0.32), (0.88, 0.78, 0.58), scale=6, rough=0.85, bump=0.05),
    "brass": noisy("Brass", (0.55, 0.38, 0.12), (0.85, 0.65, 0.28), scale=25, rough=0.3, metal=1.0, bump=0.02),
    "gold": flat("Gold", (1.0, 0.72, 0.28), rough=0.25, metal=1.0),
    "iron": flat("Iron", (0.12, 0.11, 0.10), rough=0.45, metal=1.0),
    "pewter": noisy("Pewter", (0.35, 0.34, 0.32), (0.6, 0.58, 0.55), scale=30, rough=0.35, metal=1.0, bump=0.03),
    "ivory": flat("Ivory", (0.85, 0.80, 0.68), rough=0.35),
    "pip": flat("Pip", (0.03, 0.02, 0.02), rough=0.5),
    "wax": flat("Wax", (0.86, 0.80, 0.66), rough=0.4),
    "redwax": flat("RedWax", (0.45, 0.03, 0.03), rough=0.3),
    "flame": flat("Flame", (1, 0.5, 0.15), emit=(1.0, 0.55, 0.18), strength=40),
    "glass": flat("Glass", (0.6, 0.7, 0.75), rough=0.05),
    "sand": flat("Sand", (0.75, 0.55, 0.30), rough=0.9),
    "foam": flat("Foam", (0.92, 0.88, 0.78), rough=0.9),
    "map": map_paper(),
}
M["glass"].node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.25


# ── geometry helpers ─────────────────────────────────────────────────────────────────────────────────────────────

def tag(obj, prop):
    if prop:
        obj["prop"] = prop
    return obj


def box(name, size, loc, mat, prop=None, rot=(0, 0, 0), bevel=0.006):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.name, o.scale = name, size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        m = o.modifiers.new("Bevel", "BEVEL")
        m.width, m.segments = bevel, 3
    o.data.materials.append(mat)
    return tag(o, prop)


def cyl(name, r, depth, loc, mat, prop=None, rot=(0, 0, 0), verts=48, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.object
    o.name = name
    if bevel:
        m = o.modifiers.new("Bevel", "BEVEL")
        m.width, m.segments = bevel, 2
    bpy.ops.object.shade_smooth()
    o.data.materials.append(mat)
    return tag(o, prop)


def cone(name, r1, r2, depth, loc, mat, prop=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=48)
    o = bpy.context.object
    o.name = name
    bpy.ops.object.shade_smooth()
    o.data.materials.append(mat)
    return tag(o, prop)


def sphere(name, r, loc, mat, prop=None, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=24, ring_count=12)
    o = bpy.context.object
    o.name, o.scale = name, scale
    bpy.ops.object.shade_smooth()
    o.data.materials.append(mat)
    return tag(o, prop)


def torus(name, major, minor, loc, mat, prop=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc, rotation=rot, major_segments=48, minor_segments=12)
    o = bpy.context.object
    o.name = name
    bpy.ops.object.shade_smooth()
    o.data.materials.append(mat)
    return tag(o, prop)


def group(name, parts, loc=(0, 0, 0), rot_z=0.0):
    """Parent `parts` to an empty at `loc` turned `rot_z` degrees, so a prop is placed as one."""
    bpy.ops.object.empty_add(location=(0, 0, 0))
    e = bpy.context.object
    e.name = name
    for p in parts:
        p.parent = e
    e.location, e.rotation_euler = loc, Euler((0, 0, math.radians(rot_z)))
    return e


# ── the room and the table ───────────────────────────────────────────────────────────────────────────────────────

for i in range(5):   # five boards running across, with thin gaps between
    box(f"Board{i}", (2.6, 0.316, 0.08), (0, -0.49 + i * 0.32, -0.04), M["wood"], bevel=0.008)
box("TableApron", (2.4, 1.4, 0.12), (0, 0.15, -0.14), M["darkwood"], bevel=0.0)
box("BackWall", (8, 0.2, 4), (0, 3.2, 1.0), M["wall"], bevel=0.0)
box("Floor", (8, 8, 0.1), (0, 1.0, -0.8), M["darkwood"], bevel=0.0)
for i, x in enumerate((-1.6, 1.6)):
    box(f"Beam{i}", (0.18, 0.18, 4), (x, 3.0, 1.0), M["darkwood"], bevel=0.01)

# ── the props (x across, y away from the seat; the table top is z = 0) ───────────────────────────────────────────

def tome():
    p = "quests"
    parts = [box("TomeCover", (0.56, 0.38, 0.018), (0, 0, 0.009), M["leather"], p)]
    for side in (-1, 1):
        page = box(f"TomePage{side}", (0.26, 0.35, 0.03), (side * 0.135, 0, 0.03), M["paper"], p, rot=(0, math.radians(-side * 4), 0), bevel=0.004)
        parts.append(page)
    parts.append(box("TomeSpine", (0.012, 0.36, 0.034), (0, 0, 0.028), M["darkwood"], p))
    parts.append(box("TomeRibbon", (0.012, 0.16, 0.002), (0.02, -0.25, 0.012), M["redwax"], p))
    return group("Tome", parts, (-0.05, 0.0, 0), 4)


def chest():
    p = "market"
    parts = [box("ChestBody", (0.34, 0.22, 0.13), (0, 0, 0.065), M["darkwood"], p, bevel=0.01)]
    for x in (-0.14, 0.14):
        parts.append(box(f"ChestBand{x}", (0.025, 0.226, 0.135), (x, 0, 0.066), M["iron"], p, bevel=0.003))
    parts.append(box("ChestLock", (0.05, 0.012, 0.05), (0, -0.115, 0.11), M["brass"], p, bevel=0.004))
    # The lid hinges on the back edge.
    bpy.ops.object.empty_add(location=(0, 0.11, 0.13))
    hinge = bpy.context.object
    hinge.name = "ChestHinge"
    lid = box("ChestLid", (0.345, 0.225, 0.06), (0, -0.112, 0.03), M["darkwood"], p, bevel=0.012)
    band = box("ChestLidBand", (0.35, 0.03, 0.065), (0, -0.112, 0.031), M["iron"], p, bevel=0.004)
    lid.parent = band.parent = hinge
    hinge["prop"] = p
    parts.append(hinge)
    # A few coins spilled in front, and a stack.
    for i, (x, y) in enumerate([(-0.20, -0.17), (-0.15, -0.21), (0.05, -0.19), (0.11, -0.16), (-0.03, -0.24)]):
        parts.append(cyl(f"Coin{i}", 0.022, 0.006, (x, y, 0.003), M["gold"], p, bevel=0.001))
    for i in range(6):
        parts.append(cyl(f"Stack{i}", 0.022, 0.006, (0.24, -0.15, 0.003 + i * 0.0062), M["gold"], p, bevel=0.001))
    return group("Chest", parts, (0.5, 0.0, 0), -12)


def dice():
    p = "games"
    parts = [cyl("DiceCup", 0.07, 0.15, (0, 0.06, 0.075), M["leather"], p, verts=48, bevel=0.004),
             torus("DiceCupRim", 0.07, 0.006, (0, 0.06, 0.15), M["brass"], p)]
    for i, (x, y, rz) in enumerate([(-0.03, -0.1, 20), (0.07, -0.08, -35), (0.01, -0.17, 50)]):
        die = box(f"Die{i}", (0.045, 0.045, 0.045), (x, y, 0.0225), M["ivory"], p, rot=(0, 0, math.radians(rz)), bevel=0.007)
        parts.append(die)
        for k in range(i + 1):   # pips on the top face
            off = (k - i / 2) * 0.012
            pip = cyl(f"Pip{i}{k}", 0.0045, 0.002, (0, 0, 0), M["pip"], p)
            pip.location = Vector((x, y, 0.0455)) + Euler((0, 0, math.radians(rz))).to_matrix() @ Vector((off, off, 0))
            parts.append(pip)
    return group("Dice", parts, (-0.62, 0.02, 0), 0)


def tankard():
    p = "carouse"
    parts = [cyl("TankardBody", 0.065, 0.17, (0, 0, 0.085), M["pewter"], p, bevel=0.004),
             cyl("TankardFoam", 0.06, 0.02, (0, 0, 0.17), M["foam"], p),
             torus("TankardHandle", 0.05, 0.011, (0.075, 0, 0.09), M["pewter"], p, rot=(math.radians(90), 0, 0))]
    for z in (0.03, 0.14):
        parts.append(torus(f"TankardBand{z}", 0.066, 0.005, (0, 0, z), M["darkwood"], p))
    return group("Tankard", parts, (0.92, 0.2, 0), 200)


def framed_map():
    p = "map"
    parts = [box("MapPaper", (0.66, 0.44, 0.004), (0, 0, 0.012), M["map"], p, bevel=0.0)]
    for i, (sx, sy, x, y) in enumerate([(0.72, 0.035, 0, 0.237), (0.72, 0.035, 0, -0.237), (0.035, 0.5, 0.358, 0), (0.035, 0.5, -0.358, 0)]):
        parts.append(box(f"MapFrame{i}", (sx, sy, 0.025), (x, y, 0.0125), M["darkwood"], p, bevel=0.005))
    parts.append(torus("MapCompass", 0.035, 0.004, (0.26, 0.15, 0.016), M["brass"], p))
    return group("Map", parts, (-0.02, 0.5, 0), -3)


def letter():
    p = "rumors"
    parts = [box("Letter", (0.2, 0.13, 0.006), (0, 0, 0.003), M["paper"], p, bevel=0.002),
             cyl("LetterSeal", 0.022, 0.006, (0.0, -0.02, 0.008), M["redwax"], p, bevel=0.002)]
    return group("Letter", parts, (-0.56, 0.33, 0), -22)


def hourglass():
    p = "downtime"
    parts = [cyl("HgBase", 0.06, 0.02, (0, 0, 0.01), M["darkwood"], p, bevel=0.003),
             cyl("HgTop", 0.06, 0.02, (0, 0, 0.21), M["darkwood"], p, bevel=0.003),
             cone("HgGlassLow", 0.045, 0.006, 0.09, (0, 0, 0.065), M["glass"], p),
             cone("HgGlassHigh", 0.006, 0.045, 0.09, (0, 0, 0.155), M["glass"], p),
             cone("HgSand", 0.04, 0.01, 0.04, (0, 0, 0.04), M["sand"], p)]
    for i in range(3):
        a = i * 2 * math.pi / 3
        parts.append(cyl(f"HgPost{i}", 0.006, 0.2, (math.cos(a) * 0.052, math.sin(a) * 0.052, 0.11), M["darkwood"], p))
    return group("Hourglass", parts, (-0.88, 0.42, 0), 0)


def journal():
    p = "journals"
    parts = [box("JournalCover", (0.2, 0.27, 0.045), (0, 0, 0.0225), M["green"], p, bevel=0.008),
             box("JournalPages", (0.19, 0.255, 0.035), (0.006, 0, 0.0225), M["paper"], p, bevel=0.002),
             box("JournalStrap", (0.21, 0.025, 0.048), (0, -0.06, 0.0225), M["leather"], p, bevel=0.003)]
    parts[1].location.x = 0.008
    return group("Journal", parts, (0.32, -0.36, 0), 18)


def title_card():
    p = "title"
    parts = [box("TitleCard", (0.48, 0.12, 0.004), (0, 0, 0.004), M["paper"], p, bevel=0.002)]
    for x in (-0.25, 0.25):
        parts.append(cyl(f"TitleRod{x}", 0.012, 0.15, (x, 0, 0.012), M["darkwood"], p, rot=(math.radians(90), 0, 0)))
    return group("Title", parts, (-0.05, -0.42, 0), 0)


def dial():
    p = "dial"
    parts = [cyl("DialPlate", 0.11, 0.012, (0, 0, 0.006), M["brass"], p, bevel=0.003),
             cyl("DialFace", 0.095, 0.004, (0, 0, 0.0125), M["paper"], p),
             torus("DialRing", 0.1, 0.006, (0, 0, 0.013), M["brass"], p)]
    return group("Dial", parts, (-0.5, -0.34, 0), 0)


def candle(name, loc, height):
    parts = [cyl(f"{name}Holder", 0.06, 0.012, (0, 0, 0.006), M["brass"], bevel=0.003),
             cyl(f"{name}Wax", 0.025, height, (0, 0, 0.012 + height / 2), M["wax"]),
             sphere(f"{name}Flame", 0.01, (0, 0, 0.012 + height + 0.022), M["flame"], scale=(1, 1, 2.2))]
    g = group(name, parts, loc)
    bpy.ops.object.light_add(type="POINT", location=(loc[0], loc[1], 0.012 + height + 0.06))
    light = bpy.context.object.data
    light.energy, light.color, light.shadow_soft_size = 30, (1.0, 0.52, 0.2), 0.03
    return g


tome()
chest_root = chest()
dice()
tankard()
framed_map()
letter()
hourglass()
journal()
title_card()
dial()
candle("CandleL", (-0.42, 0.62, 0), 0.22)
candle("CandleR", (0.66, 0.6, 0), 0.15)
candle("CandleF", (-0.86, 0.14, 0), 0.1)

# A dim warm fill from above and a faint cool rim from behind, so the table reads without flattening the candles.
bpy.ops.object.light_add(type="AREA", location=(0, 0.1, 1.6))
fill = bpy.context.object.data
fill.energy, fill.size, fill.color = 14, 2.0, (1.0, 0.72, 0.45)
bpy.ops.object.light_add(type="SPOT", location=(-1.2, 2.4, 1.4), rotation=(math.radians(-60), 0, math.radians(-150)))
rim = bpy.context.object.data
rim.energy, rim.color, rim.spot_size = 60, (0.55, 0.65, 1.0), math.radians(60)

world = bpy.data.worlds.new("World")
scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.003, 0.002, 1)

# ── the camera: a seat at the near edge, looking down the table ──────────────────────────────────────────────────

bpy.ops.object.camera_add(location=(0, -1.55, 0.78))
cam = bpy.context.object
target = Vector((0, 0.12, 0))
cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
cam.data.lens = 30
scene.camera = cam


def px(co):
    v = world_to_camera_view(scene, cam, Vector(co))
    return [round(v.x * W, 1), round((1 - v.y) * H, 1)]


def quad(obj_name, hx, hy, z):
    """The four corners (top left, top right, bottom right, bottom left as seen) of a face of half-size hx, hy at height z in the object's frame."""
    o = bpy.data.objects[obj_name]
    bpy.context.view_layer.update()
    m = o.matrix_world
    return [px(m @ Vector(c)) for c in ((-hx, hy, z), (hx, hy, z), (hx, -hy, z), (-hx, -hy, z))]


def write_projection():
    bpy.context.view_layer.update()
    seats = [(-0.66, 0.98), (-0.22, 0.98), (0.22, 0.98), (0.66, 0.98), (-1.16, 0.45), (1.16, 0.45), (-1.2, -0.05), (1.2, -0.05)]
    data = {
        "size": [W, H],
        "tomeLeft": quad("TomePage-1", 0.12, 0.165, 0.015),
        "tomeRight": quad("TomePage1", 0.12, 0.165, 0.015),
        "title": quad("TitleCard", 0.22, 0.055, 0.002),
        "dial": quad("DialFace", 0.095, 0.095, 0.002),
        "chestFront": px(bpy.data.objects["ChestLock"].matrix_world.translation + Vector((0, 0, -0.06))),
        "seats": [px((x, y, 0.32)) for x, y in seats],
    }
    with open(os.path.join(OUT, "projection.json"), "w") as f:
        json.dump(data, f, indent=1)


def render(path):
    scene.render.filepath = os.path.join(OUT, path)
    bpy.ops.render.render(write_still=True)


def id_pass(path):
    """Every prop in its own flat colour, everything else black, no lighting, no colour management."""
    saved = {o.name: list(o.data.materials) for o in scene.objects if o.type == "MESH"}
    flats = {p: flat(f"ID_{p}", (0, 0, 0), emit=c, strength=1.0) for p, c in ID_COLOURS.items()}
    black = flat("ID_none", (0, 0, 0))
    for o in scene.objects:
        if o.type != "MESH":
            continue
        prop = None
        walk = o
        while walk and not prop:
            prop = walk.get("prop")
            walk = walk.parent
        o.data.materials.clear()
        o.data.materials.append(flats.get(prop, black))
    view, look, exposure = scene.view_settings.view_transform, scene.view_settings.look, scene.view_settings.exposure
    scene.view_settings.view_transform, scene.view_settings.look, scene.view_settings.exposure = "Standard", "None", 0
    lights = [o for o in scene.objects if o.type == "LIGHT"]
    for o in lights:
        o.hide_render = True
    samples = scene.eevee.taa_render_samples
    scene.eevee.taa_render_samples, scene.render.filter_size = 1, 0.0
    render(path)
    scene.eevee.taa_render_samples, scene.render.filter_size = samples, 1.5
    for o in lights:
        o.hide_render = False
    scene.view_settings.view_transform, scene.view_settings.look, scene.view_settings.exposure = view, look, exposure
    for o in scene.objects:
        if o.type == "MESH" and o.name in saved:
            o.data.materials.clear()
            for m in saved[o.name]:
                o.data.materials.append(m)


write_projection()
if not PREVIEW:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "table.blend"), compress=True)
render("beauty.png")
if not PREVIEW:
    id_pass("ids.png")
if not PREVIEW:
    # The chest, open: its lid up and gold heaped inside.
    bpy.data.objects["ChestHinge"].rotation_euler = Euler((math.radians(-105), 0, 0))
    for i in range(18):
        a = i * 2.4
        local = Vector((math.cos(a) * 0.045 * (i % 3), math.sin(a) * 0.03 * (i % 4), 0.124 + (i % 3) * 0.007))
        g = cyl(f"ChestGold{i}", 0.022, 0.006, (0, 0, 0), M["gold"], "market", rot=(math.radians(i * 7), math.radians(i * 11), 0))
        g.location = chest_root.matrix_world @ local
    render("beauty-open.png")
    id_pass("ids-open.png")
print("LANDING_TABLE_DONE")
