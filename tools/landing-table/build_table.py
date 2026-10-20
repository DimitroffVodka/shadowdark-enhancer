"""
Shadowdark Enhancer: the landing page's table, built and rendered in Blender (the module's own art).

    nice -n 19 blender --background --factory-startup --python tools/landing-table/build_table.py

A candle-lit wooden table seen from a seat at it, with the props that are the page's buttons: the quest tome, the
coin chest, the dice cup, the goblets, the framed map, the sealed letter, the hourglass, the journal, the recap
scrolls, the session title card and the day dial. The chest, the goblets, the candlesticks, the compass on the map
and the table's wood and leather are CC0 assets from Poly Haven (fetch_assets.py downloads them into $LT_ART, default
~/git/.demo/landing-art); everything else is modelled here. Writes to tools/landing-table/out/:

    beauty.png        the table as it rests (chest closed)
    ids.png           every prop in its own flat colour, for the per-prop masks
    beauty-open.png   the same with the chest open (for its opening)
    ids-open.png      its masks
    projection.json   where the overlay quads (tome pages, title card, dial) and the party's seats land, in pixels

make_assets.py turns those into the module's assets; only those rendered pictures ship, never the Poly Haven files.
"""
import json
import math
import os

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.expanduser(os.environ.get("LT_ART", "~/git/.demo/landing-art"))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)
W, H = 2560, 1440

# The flat colour each prop gets in ids.png (make_assets.py reads the same table).
PROPS = ["quests", "market", "games", "carouse", "map", "rumors", "downtime", "journals", "title", "dial", "recaps",
         "seat0", "seat1", "seat2", "seat3", "seat4", "seat5"]
ID_COLOURS = {p: c for p, c in zip(PROPS, [
    (1, 0, 0), (0, 1, 0), (0, 0, 1), (1, 1, 0), (1, 0, 1), (0, 1, 1), (1, .5, 0), (.5, 0, 1), (0, .5, 1), (1, 0, .5), (.5, 1, 0),
    (.5, .5, 0), (0, .5, .5), (.5, 0, .5), (1, 1, 1), (1, .5, .5), (.5, .5, 1),
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


def socket(node, ident, outputs=False):
    return next(x for x in (node.outputs if outputs else node.inputs) if x.identifier == ident)


def stained(nt, colour_out, scale=2.4, strength=0.55, speckle=0.25):
    """Multiply blotchy stains and a fine speckle over `colour_out`: parchment and leather that have been handled for years."""
    n = nt.nodes
    coord = n.new("ShaderNodeTexCoord")
    out = colour_out
    for sc, cut, amt in ((scale, 0.55, strength), (60.0, 0.62, speckle)):
        tex = n.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = sc
        tex.inputs["Detail"].default_value = 6.0
        nt.links.new(coord.outputs["Object"], tex.inputs["Vector"])
        ramp = n.new("ShaderNodeValToRGB")
        e = ramp.color_ramp.elements
        e[0].position, e[0].color = cut - 0.08, (1, 1, 1, 1)
        e[1].position, e[1].color = cut + 0.12, (0.32, 0.19, 0.08, 1)
        nt.links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
        mix = n.new("ShaderNodeMix")
        mix.data_type, mix.blend_type = "RGBA", "MULTIPLY"
        mix.inputs[0].default_value = amt
        nt.links.new(out, socket(mix, "A_Color"))
        nt.links.new(ramp.outputs["Color"], socket(mix, "B_Color"))
        out = socket(mix, "Result_Color", True)
    return out


def aged(mat, strength=0.55):
    """Stain an existing material: whatever feeds its Base Color goes through stained()."""
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    link = next((l for l in nt.links if l.to_socket == b.inputs["Base Color"]), None)
    if link:
        src = link.from_socket
        nt.links.remove(link)
    else:
        rgb = nt.nodes.new("ShaderNodeRGB")
        rgb.outputs[0].default_value = b.inputs["Base Color"].default_value[:]
        src = rgb.outputs[0]
    nt.links.new(stained(nt, src, strength=strength), b.inputs["Base Color"])
    return mat


def tinted(mat, name, hue, sat=1.0, value=1.0):
    """A copy of `mat` with its colour turned (a green leather from a red one)."""
    m = mat.copy()
    m.name = name
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    link = next((l for l in nt.links if l.to_socket == b.inputs["Base Color"]), None)
    if link:
        hs = nt.nodes.new("ShaderNodeHueSaturation")
        hs.inputs["Hue"].default_value, hs.inputs["Saturation"].default_value, hs.inputs["Value"].default_value = hue, sat, value
        nt.links.new(link.from_socket, hs.inputs["Color"])
        nt.links.remove(link)
        nt.links.new(hs.outputs["Color"], b.inputs["Base Color"])
    return m


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
        nt.links.new(stained(nt, ramp.outputs["Color"], strength=0.5), b.inputs["Base Color"])
    return material("MapPaper", build)


M = {
    "wood": noisy("TableWood", (0.04, 0.016, 0.006), (0.30, 0.15, 0.06), scale=4.0, detail=9.0, grain=(0.22, 16, 1), bump=0.35),
    "darkwood": noisy("DarkWood", (0.04, 0.02, 0.01), (0.14, 0.07, 0.03), scale=3, stretch=(1, 6, 1)),
    "wall": noisy("Wall", (0.015, 0.012, 0.01), (0.05, 0.035, 0.025), scale=4, bump=0.4),
    "leather": noisy("Leather", (0.12, 0.03, 0.02), (0.30, 0.09, 0.05), scale=40, rough=0.55),
    "green": noisy("GreenLeather", (0.02, 0.06, 0.04), (0.06, 0.16, 0.10), scale=40, rough=0.5),
    "paper": noisy("Parchment", (0.52, 0.40, 0.24), (0.80, 0.68, 0.47), scale=6, rough=0.85, bump=0.08),
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
    "ink": flat("Ink", (0.02, 0.02, 0.03), rough=0.1),
    "feather": flat("Feather", (0.82, 0.78, 0.7), rough=0.7),
    "crumb": flat("Crumb", (0.55, 0.36, 0.16), rough=0.9),
}
aged(M["paper"], 0.9)
aged(M["wax"], 0.15)
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


# ── Poly Haven assets (CC0) ──────────────────────────────────────────────────────────────────────────────────────

def ph_path(asset):
    path = os.path.join(ART, asset, f"{asset}.blend")
    if not os.path.exists(path):
        raise SystemExit(f"{path} is missing: run tools/landing-table/fetch_assets.py first")
    return path


def ph_objects(asset, names):
    """Append the named objects of a Poly Haven asset into the scene (its textures stay in the art folder)."""
    with bpy.data.libraries.load(ph_path(asset), link=False) as (src, dst):
        dst.objects = [n for n in src.objects if n in names]
    objs = [o for o in dst.objects if o]
    for o in objs:
        scene.collection.objects.link(o)
    return objs


def ph_material(asset, scale, rot_z=0.0):
    """A Poly Haven surface laid on by object coordinates (so any box takes it), `scale` repeats per metre."""
    with bpy.data.libraries.load(ph_path(asset), link=False) as (src, dst):
        dst.materials = [asset]
    mat = dst.materials[0]
    nt = mat.node_tree
    coord, mapping = nt.nodes.new("ShaderNodeTexCoord"), nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    mapping.inputs["Rotation"].default_value = (0, 0, rot_z)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    for node in nt.nodes:
        if node.type == "TEX_IMAGE":
            nt.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
    return mat


def ph_place(name, objs, loc, scale, rot_z=0.0, prop=None):
    """Parent appended objects to an empty at `loc`, scaled and turned as one, tagged with their prop."""
    bpy.ops.object.empty_add(location=(0, 0, 0))
    e = bpy.context.object
    e.name = name
    for o in objs:
        if not o.parent:
            o.parent = e
        tag(o, prop)
    tag(e, prop)
    e.location, e.scale, e.rotation_euler = loc, (scale, scale, scale), Euler((0, 0, math.radians(rot_z)))
    return e


M["wood"] = ph_material("wood_table_001", 0.6, math.radians(90))
M["leather"] = aged(ph_material("leather_red_02", 3.0), 0.35)
M["green"] = aged(tinted(M["leather"], "GreenLeather", 0.83, 0.7, 0.8), 0.3)

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


CHEST_SCALE = 0.36


def chest():
    """Poly Haven's treasure chest (its lid hinges on its own back edge), with a few coins spilled in front."""
    p = "market"
    root = ph_place("Chest", ph_objects("treasure_chest", ["treasure_chest_bottom", "treasure_chest_lid", "treasure_chest_lock", "treasure_chest_handle_left", "treasure_chest_handle_right"]),
                    (0.5, 0.02, 0), CHEST_SCALE, -12, p)
    coins = []
    for i, (x, y) in enumerate([(-0.20, -0.17), (-0.15, -0.21), (0.05, -0.19), (0.11, -0.16), (-0.03, -0.24)]):
        coins.append(cyl(f"Coin{i}", 0.022, 0.006, (x, y, 0.003), M["gold"], p, bevel=0.001))
    for i in range(6):
        coins.append(cyl(f"Stack{i}", 0.022, 0.006, (0.24, -0.15, 0.003 + i * 0.0062), M["gold"], p, bevel=0.001))
    group("Coins", coins, (0.5, 0.0, 0), -12)
    return root


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


def goblets():
    """Two of Poly Haven's brass goblets, one a little behind the other."""
    p = "carouse"
    ph_place("Goblet1", ph_objects("brass_goblets", ["brass_goblet_01"]), (0.9, 0.22, 0), 0.62, 0, p)
    ph_place("Goblet3", ph_objects("brass_goblets", ["brass_goblet_03"]), (1.02, 0.36, 0), 0.62, 30, p)


def framed_map():
    p = "map"
    parts = [box("MapPaper", (0.66, 0.44, 0.004), (0, 0, 0.012), M["map"], p, bevel=0.0)]
    for i, (sx, sy, x, y) in enumerate([(0.72, 0.035, 0, 0.237), (0.72, 0.035, 0, -0.237), (0.035, 0.5, 0.358, 0), (0.035, 0.5, -0.358, 0)]):
        parts.append(box(f"MapFrame{i}", (sx, sy, 0.025), (x, y, 0.0125), M["darkwood"], p, bevel=0.005))
    g = group("Map", parts, (-0.02, 0.5, 0), -3)
    ph_place("Compass", ph_objects("seadogs_compass", ["seadogs_compass", "seadogs_compass_lid", "seadogs_compass_needle"]), (0.16, 0.56, 0.014), 1.3, 20, p)
    return g


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


def recap_scrolls():
    """The session recaps: three rolled scrolls tied with a ribbon, one a little apart."""
    p = "recaps"
    parts = []
    for i, (x, y, r) in enumerate([(0, 0, 0.032), (0.0, 0.07, 0.03), (0.035, 0.035, 0.028)]):
        z = r + (0.045 if i == 2 else 0)
        parts.append(cyl(f"Scroll{i}", r, 0.3, (x, y, z), M["paper"], p, rot=(0, math.radians(90), 0), verts=40))
        for end in (-0.16, 0.16):
            parts.append(cyl(f"ScrollRod{i}{end}", r * 0.45, 0.03, (x + end, y, z), M["darkwood"], p, rot=(0, math.radians(90), 0)))
    parts.append(torus("ScrollRibbon", 0.07, 0.007, (0.0, 0.035, 0.045), M["redwax"], p, rot=(0, math.radians(90), 0)))
    return group("Recaps", parts, (0.7, -0.22, 0), 28)


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


def candle(name, loc, height, holder=0.8):
    """A wax candle on Poly Haven's wooden candlestick (`holder` scales it; it is 0.22 m tall at 1)."""
    ph_place(f"{name}Stick", ph_objects("wooden_candlestick", ["wooden_candlestick"]), loc, holder)
    top = 0.22 * holder
    parts = [cyl(f"{name}Wax", 0.02, height, (0, 0, top + height / 2), M["wax"]),
             sphere(f"{name}Flame", 0.01, (0, 0, top + height + 0.022), M["flame"], scale=(1, 1, 2.2)),
             cyl(f"{name}Puddle", 0.03, 0.006, (0, 0, top + 0.003), M["wax"], bevel=0.002)]
    for k, (a, drop) in enumerate([(0.4, 0.55), (2.1, 0.35), (3.6, 0.75), (5.0, 0.45)]):
        # Drips run from the rim down the side, each a stretched bead.
        parts.append(sphere(f"{name}Drip{k}", 0.006, (math.cos(a) * 0.02, math.sin(a) * 0.02, top + height * (1 - drop / 2)), M["wax"], scale=(1, 1, height * drop / 0.012)))
    g = group(name, parts, loc)
    bpy.ops.object.light_add(type="POINT", location=(loc[0], loc[1], top + height + 0.06))
    light = bpy.context.object.data
    light.energy, light.color, light.shadow_soft_size = 30, (1.0, 0.52, 0.2), 0.03
    return g


def clutter():
    """What a table that has been sat at looks like: an inkwell and quill, a pipe, crumbs, loose coins. Nothing here is a button."""
    ink = [cyl("Inkwell", 0.03, 0.04, (0, 0, 0.02), M["ink"], bevel=0.004), cyl("InkNeck", 0.014, 0.014, (0, 0, 0.047), M["ink"]),
           cyl("InkLip", 0.017, 0.004, (0, 0, 0.055), M["brass"])]
    quill = sphere("Quill", 0.01, (0.03, 0.02, 0.12), M["feather"], scale=(1.2, 9.0, 0.25))
    quill.rotation_euler = Euler((math.radians(62), 0, math.radians(-25)))
    shaft = cyl("QuillShaft", 0.0025, 0.12, (0.006, 0.004, 0.06), M["wax"], rot=(math.radians(28), 0, math.radians(-25)))
    group("Ink", ink + [quill, shaft], (0.6, -0.5, 0), 0)
    pipe = [cyl("PipeBowl", 0.016, 0.034, (0, 0, 0.017), M["darkwood"], bevel=0.003), cyl("PipeAsh", 0.013, 0.002, (0, 0, 0.033), M["iron"]),
            cyl("PipeStem", 0.004, 0.14, (0.075, 0, 0.012), M["darkwood"], rot=(0, math.radians(84), 0))]
    group("Pipe", pipe, (-0.6, -0.58, 0), 15)
    crumbs = [sphere(f"Crumb{i}", 0.004 + (i % 3) * 0.002, (0.82 + math.cos(i * 2.3) * 0.06 * (i % 4) / 3, 0.02 + math.sin(i * 1.7) * 0.05, 0.003), M["crumb"], scale=(1, 1, 0.6)) for i in range(14)]
    group("Crumbs", crumbs)
    loose = [cyl(f"Loose{i}", 0.022, 0.006, (x, y, 0.003), M["gold"], rot=(math.radians(t), 0, 0), bevel=0.001)
             for i, (x, y, t) in enumerate([(0.18, -0.25, 0), (0.21, -0.29, 8), (-0.38, -0.1, 0), (-0.95, -0.22, 0), (0.9, -0.42, 0)])]
    group("LooseCoins", loose)


SEAT_X = [-0.2, 0.2, -0.62, 0.86, -1.02, 1.16]
FRAMES = []


def frames():
    """Six standing portrait frames along the far edge of the table, one per seat; only as many as the party shows."""
    for i, x in enumerate(SEAT_X):
        p = f"seat{i}"
        w, h, t = 0.15, 0.19, 0.016
        parts = [box(f"Frame{i}Back", (w, 0.012, h), (0, 0.004, h / 2), M["darkwood"], p, bevel=0.003),
                 box(f"Frame{i}Face", (w - 2 * t, 0.002, h - 2 * t), (0, -0.003, h / 2), M["paper"], p, bevel=0)]
        for j, (sx, sz, lx, lz) in enumerate([(w, t, 0, h - t / 2), (w, t, 0, t / 2), (t, h, -w / 2 + t / 2, h / 2), (t, h, w / 2 - t / 2, h / 2)]):
            parts.append(box(f"Frame{i}Side{j}", (sx, 0.02, sz), (lx, -0.002, lz), M["brass"] if j < 2 else M["darkwood"], p, bevel=0.002))
        parts.append(box(f"Frame{i}Stand", (0.03, 0.08, 0.008), (0, 0.04, 0.004), M["darkwood"], p, bevel=0.002))
        g = group(f"Frame{i}", parts, (x, 0.86, 0), 0)
        g.rotation_euler = Euler((math.radians(-12), 0, math.radians(-x * 6)))
        FRAMES.append(g)


def show_frames(on):
    for g in FRAMES:
        for o in [g, *g.children_recursive]:
            o.hide_render = not on


tome()
chest_root = chest()
clutter()
frames()
dice()
goblets()
framed_map()
letter()
hourglass()
journal()
title_card()
dial()
recap_scrolls()
candle("CandleL", (-0.42, 0.66, 0), 0.12, 1.0)
candle("CandleR", (0.66, 0.62, 0), 0.08, 0.85)
candle("CandleF", (-0.86, 0.14, 0), 0.06, 0.6)

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


def quad_xz(obj_name, hx, hz):
    """The corners of an upright face (in its object's x-z plane) as seen: top left, top right, bottom right, bottom left."""
    o = bpy.data.objects[obj_name]
    bpy.context.view_layer.update()
    m = o.matrix_world
    return [px(m @ Vector(c)) for c in ((-hx, -0.002, hz), (hx, -0.002, hz), (hx, -0.002, -hz), (-hx, -0.002, -hz))]


def write_projection():
    bpy.context.view_layer.update()
    data = {
        "size": [W, H],
        "tomeLeft": quad("TomePage-1", 0.12, 0.165, 0.015),
        "tomeRight": quad("TomePage1", 0.12, 0.165, 0.015),
        "title": quad("TitleCard", 0.22, 0.055, 0.002),
        "dial": quad("DialFace", 0.095, 0.095, 0.002),
        "chestFront": px(bpy.data.objects["treasure_chest_lock"].matrix_world @ Vector((0, 0, -0.32))),
        "frames": [quad_xz(f"Frame{i}Face", 0.059, 0.079) for i in range(len(SEAT_X))],
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
show_frames(False)
render("beauty.png")
show_frames(True)
if PREVIEW:
    render("beauty-frames.png")
if not PREVIEW:
    render("beauty-frames.png")
    id_pass("ids.png")
    show_frames(False)
if not PREVIEW:
    # The chest, open: its lid up and gold heaped inside.
    bpy.data.objects["treasure_chest_lid"].rotation_euler = Euler((math.radians(-100), 0, 0))
    bpy.context.view_layer.update()
    # A heap of small coins: a mound in the chest's own frame (its interior spans x +-0.42, y +-0.22 before scaling).
    shine = flat("GoldShine", (0.95, 0.58, 0.1), rough=0.28, metal=1.0, emit=(1.0, 0.55, 0.1), strength=0.35)
    for i in range(90):
        a, r = i * 2.39996, 0.4 * math.sqrt((i + 0.5) / 90)
        x, y = math.cos(a) * r * 0.95, math.sin(a) * r * 0.5
        z = 0.30 + 0.16 * (1 - (x / 0.42) ** 2 - (y / 0.22) ** 2) ** 0.5 if abs(x) < 0.42 and abs(y) < 0.22 else 0.30
        g = cyl(f"ChestGold{i}", 0.012, 0.003, (0, 0, 0), shine, "market", rot=(math.radians((i * 37) % 50 - 25), math.radians((i * 53) % 50 - 25), 0), verts=24)
        g.location = chest_root.matrix_world @ Vector((x, y, z))
    # The treasure catches the light as the lid comes up.
    bpy.ops.object.light_add(type="POINT", location=chest_root.matrix_world @ Vector((0, 0, 0.75)))
    glow = bpy.context.object.data
    glow.energy, glow.color, glow.shadow_soft_size = 6, (1.0, 0.75, 0.35), 0.05
    render("beauty-open.png")
    id_pass("ids-open.png")
print("LANDING_TABLE_DONE")
