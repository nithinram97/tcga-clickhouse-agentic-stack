"""
Clairvoyant: "Orb chases the spark"  (Blender animation script)
===============================================================

HOW TO RUN
  1. Open Blender 4.2 or newer (tested on 5.2). Start a NEW General file.
  2. Switch to the "Scripting" workspace tab at the top.
  3. In the Text Editor: Text > Open... > pick this file (or New, then paste it in).
  4. Click "Run Script" (the play button), or press Alt+P with the mouse over the text.
     The scene is wiped and rebuilt (about 10-30 s).
  5. Switch back to the "Layout" tab. In the 3D viewport press Numpad 0 for the
     camera view, set the viewport shading to Rendered (Z > Rendered), and press
     Space to play. Playback is slow in Rendered mode; Solid mode plays smoothly.
  6. To render the film: Render > Render Animation (Ctrl+F12). The MP4 is written
     next to your saved .blend file (save the .blend first), named clairvoyant_orb_*.mp4.
     Render a single frame with F12 to check a moment.
  Headless: blender -b -P clairvoyant_orb_story.py -a

TIPS
  * Draft quickly: set RENDER_SAMPLES = 16 and RES_X, RES_Y = 1280, 720 below.
  * Change the tagline (or set TAGLINE = "" to remove it) below.
  * Each story beat's start frame is a constant (F_POP, F_CHASE ... F_TITLE) in
    the STORY section, so you can retime a beat in one place.

STORY (500 frames @ 30 fps, about 16.5 s)
  001  Idle: Orb's antenna tip starts to twitch.
  032  The tip pops off and flies away, drawing an amber line chart behind it.
  062  The chase: Orb waddle-hops after it.
  100  He climbs the bars. The chart IS the logo's four KPI bars, at 12x scale.
  160  The stumble: the last step is the biggest; he falls short and dangles.
  212  The edge: on the amber bar, the spark is out in the void past the chart.
  252  Foresight: he closes his eyes, glows, a dashed forecast line projects
       to where the spark WILL be.
  300  Leap of faith along the forecast line.
  330  The catch: the spark snaps back onto his antenna; the dashes become the
       solid breakout line.
  348  The reveal: the open C ring draws around the chart, the bars turn white,
       and the whole thing rises out of the floor as the V stand and groundline
       emerge. The chase drew the logo.
  412  Orb melts into the breakout point.
  440  The official CLAIRVOYANT wordmark (Michroma outlines, embedded) and tagline.
"""

import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix

# --------------------------------------------------------------------------
# Settings you may want to change
# --------------------------------------------------------------------------
FPS = 30
FRAME_END = 500
TAGLINE = "We don\u2019t chase the number. We see where it\u2019s going."   # set to "" to drop it
RES_X, RES_Y = 1920, 1080
RENDER_SAMPLES = 64
OUTPUT_PATH = "//clairvoyant_orb_"   # relative to the .blend file location

# Brand colours
SLATE = "#2F4356"
SLATE_DEEP = "#16202B"
AMBER = "#F5B942"
AMBER_DEEP = "#E8A33D"
ICE = "#CFE3F5"
BLUSH = "#F28B82"
LOGO_WHITE = "#FFFFFF"

# Official logo geometry, in SVG units (see clairvoyant-mark.svg), scaled up 12x:
# the chart Orb climbs IS the logo's four KPI bars. Baseline (SVG y=150) sits on the floor.
S_LOGO = 1.0 / 12.0
ORB_SCALE = 0.35        # Orb is small next to the giant logo
LOGO_LIFT = 11.0        # how far the whole lockup rises out of the floor at the end


def LX(x):
    return (x - 190) * S_LOGO


def LZ(y):
    return (150 - y) * S_LOGO


# Michroma (SIL Open Font License) outlines for the letters of CLAIRVOYANT,
# as cubic Bezier contours in font units: {letter: (advance, [[(anchor, handle_in, handle_out), ...], ...])}
MICHROMA_UPM = 2048
MICHROMA_CAP = 1536
MICHROMA = {'A':(2176,[[((64,0),(139,0),(363,512)),((960,1536),(661,1024),(1045,1536)),((1216,1536),(1131,1536),(1515,1024)),((2112,0),(1813,512),(2037,0)),((1888,0),(1963,0),(1824,117)),((1696,352),(1760,235),(1291,352)),((480,352),(885,352),(416,235)),((288,0),(352,117),(213,0))],[((576,512),(747,811),(917,512)),((1600,512),(1259,512),(1429,811)),((1088,1408),(1259,1109),(917,1109))]]),'C':(2145,[[((128,748),(128,583),(128,761)),((128,788),(128,775),(128,924)),((148,1130),(135,1038),(161,1223)),((217,1356),(184,1298),(250,1414)),((350,1489),(294,1458),(407,1520)),((563,1552),(478,1540),(648,1562)),((871,1568),(751,1568),(1005,1568)),((1274,1568),(1140,1568),(1411,1568)),((1622,1548),(1527,1562),(1716,1536)),((1850,1472),(1792,1510),(1907,1433)),((1975,1302),(1949,1377),(2001,1228)),((2014,1007),(2014,1130),(1950,1007)),((1822,1007),(1886,1007),(1822,1104)),((1796,1232),(1813,1179),(1779,1286)),((1708,1349),(1750,1325),(1668,1373)),((1541,1394),(1612,1388),(1470,1399)),((1274,1402),(1381,1402),(1140,1402)),((871,1402),(1005,1402),(776,1402)),((630,1394),(695,1399),(565,1388)),((470,1354),(512,1375),(430,1334)),((376,1258),(398,1302),(355,1214)),((332,1078),(340,1154),(324,1002)),((320,788),(320,905),(320,775)),((320,748),(320,761),(320,635)),((332,466),(324,541),(340,391)),((376,287),(355,332),(398,242)),((470,187),(430,209),(512,165)),((630,144),(565,151),(695,137)),((871,134),(776,134),(1005,134)),((1274,134),(1140,134),(1381,134)),((1541,141),(1470,136),(1612,146)),((1708,182),(1668,159),(1750,205)),((1796,296),(1779,242),(1813,348)),((1822,519),(1822,423),(1886,519)),((2014,519),(1950,519),(2014,396)),((1975,225),(2001,298),(1949,152)),((1850,60),(1907,96),(1792,22)),((1622,-14),(1716,-2),(1527,-26)),((1274,-32),(1411,-32),(1140,-32)),((871,-32),(1005,-32),(721,-32)),((501,-2),(598,-22),(404,19)),((274,111),(329,56),(220,166)),((160,347),(182,244),(139,450))]]),'I':(576,[[((192,0),(256,0),(192,512)),((192,1536),(192,1024),(256,1536)),((384,1536),(320,1536),(384,1024)),((384,0),(384,512),(320,0))]]),'L':(1664,[[((192,0),(661,0),(192,512)),((192,1536),(192,1024),(256,1536)),((384,1536),(320,1536),(384,1077)),((384,160),(384,619),(789,160)),((1600,160),(1195,160),(1600,107)),((1600,0),(1600,53),(1131,0))]]),'N':(2321,[[((192,0),(256,0),(192,512)),((192,1536),(192,1024),(259,1536)),((392,1536),(325,1536),(906,1103)),((1935,237),(1421,670),(1936,237)),((1937,237),(1936,237),(1937,670)),((1937,1536),(1937,1103),(2001,1536)),((2129,1536),(2065,1536),(2129,1024)),((2129,0),(2129,512),(2062,0)),((1929,0),(1996,0),(1415,437)),((386,1310),(900,873),(385,1310)),((384,1310),(385,1310),(384,873)),((384,0),(384,437),(320,0))]]),'O':(2145,[[((871,-32),(1005,-32),(721,-32)),((501,-2),(598,-22),(404,19)),((274,111),(329,56),(220,166)),((160,347),(182,244),(139,450)),((128,748),(128,583),(128,761)),((128,788),(128,775),(128,924)),((148,1130),(135,1038),(161,1223)),((217,1356),(184,1298),(250,1414)),((350,1489),(294,1458),(407,1520)),((563,1552),(478,1540),(648,1562)),((871,1568),(751,1568),(1005,1568)),((1274,1568),(1140,1568),(1394,1568)),((1582,1552),(1497,1562),(1667,1540)),((1794,1489),(1738,1520),(1851,1458)),((1928,1356),(1895,1414),(1961,1298)),((1997,1130),(1984,1223),(2010,1038)),((2017,788),(2017,924),(2017,775)),((2017,748),(2017,761),(2017,583)),((1984,347),(2006,450),(1963,244)),((1870,111),(1925,166),(1816,56)),((1644,-2),(1741,19),(1547,-22)),((1274,-32),(1424,-32),(1140,-32))],[((871,134),(776,134),(1005,134)),((1274,134),(1140,134),(1369,134)),((1515,144),(1450,137),(1580,151)),((1674,187),(1634,165),(1716,209)),((1768,287),(1747,242),(1790,332)),((1813,466),(1805,391),(1821,541)),((1825,748),(1825,635),(1825,761)),((1825,788),(1825,775),(1825,905)),((1813,1078),(1821,1002),(1805,1154)),((1768,1258),(1790,1214),(1747,1302)),((1674,1354),(1716,1334),(1634,1375)),((1515,1394),(1580,1388),(1450,1399)),((1274,1402),(1369,1402),(1140,1402)),((871,1402),(1005,1402),(776,1402)),((630,1394),(695,1399),(565,1388)),((470,1354),(512,1375),(430,1334)),((376,1258),(398,1302),(355,1214)),((332,1078),(340,1154),(324,1002)),((320,788),(320,905),(320,775)),((320,748),(320,761),(320,635)),((332,466),(324,541),(340,391)),((376,287),(355,332),(398,242)),((470,187),(430,209),(512,165)),((630,144),(565,151),(695,137))]]),'R':(2087,[[((196,1536),(196,1024),(539,1536)),((1224,1536),(881,1536),(1374,1536)),((1586,1516),(1495,1529),(1678,1503)),((1795,1447),(1748,1480),(1842,1414)),((1891,1313),(1874,1370),(1908,1256)),((1916,1098),(1916,1185),(1916,1085)),((1916,1058),(1916,1071),(1916,978)),((1888,852),(1906,909),(1868,794)),((1778,712),(1832,747),(1724,676)),((1538,636),(1644,651),(1649,424)),((1872,0),(1761,212),(1808,0)),((1680,0),(1744,0),(1571,207)),((1353,622),(1462,415),(1340,621)),((1312,621),(1326,621),(1297,621)),((1267,621),(1282,621),(974,621)),((388,621),(681,621),(388,414)),((388,0),(388,207),(324,0)),((196,0),(260,0),(196,512))],[((388,787),(388,981),(671,787)),((1237,787),(954,787),(1351,787)),((1506,798),(1441,791),(1572,806)),((1652,839),(1620,820),(1682,858)),((1711,921),(1702,886),(1720,956)),((1724,1058),(1724,1002),(1724,1071)),((1724,1098),(1724,1085),(1724,1161)),((1706,1248),(1718,1211),(1694,1285)),((1634,1329),(1670,1312),(1598,1346)),((1473,1362),(1544,1358),(1402,1368)),((1187,1370),(1306,1370),(921,1370)),((388,1370),(654,1370),(388,1176))]]),'T':(1916,[[((862,0),(926,0),(862,459)),((862,1376),(862,917),(606,1376)),((94,1376),(350,1376),(94,1429)),((94,1536),(94,1483),(670,1536)),((1822,1536),(1246,1536),(1822,1483)),((1822,1376),(1822,1429),(1566,1376)),((1054,1376),(1310,1376),(1054,917)),((1054,0),(1054,459),(990,0))]]),'V':(2048,[[((896,0),(981,0),(620,512)),((68,1536),(344,1024),(141,1536)),((288,1536),(215,1536),(533,1069)),((1024,136),(779,603),(1269,603)),((1760,1536),(1515,1069),(1832,1536)),((1977,1536),(1905,1536),(1702,1024)),((1152,0),(1427,512),(1067,0))]]),'Y':(2176,[[((992,0),(1056,0),(992,213)),((992,640),(992,427),(704,939)),((128,1536),(416,1237),(213,1536)),((384,1536),(299,1536),(619,1285)),((1088,784),(853,1035),(1323,1035)),((1792,1536),(1557,1285),(1877,1536)),((2048,1536),(1963,1536),(1760,1237)),((1184,640),(1472,939),(1184,427)),((1184,0),(1184,213),(1120,0))]])}


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h, a=1.0):
    h = h.lstrip("#")
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (a,)


def set_input(node, names, value):
    """Set the first existing input among several possible names (API changes across versions)."""
    if isinstance(names, str):
        names = [names]
    for n in names:
        if n in node.inputs:
            node.inputs[n].default_value = value
            return node.inputs[n]
    return None


def link_obj(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def new_empty(name, loc=(0, 0, 0), parent=None, size=0.3):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = size
    e.location = loc
    link_obj(e)
    if parent:
        e.parent = parent
    return e


def mesh_obj(name, build, mat=None, parent=None, loc=(0, 0, 0), smooth=True):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    build(bm)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    link_obj(ob)
    if mat:
        ob.data.materials.append(mat)
    if parent:
        ob.parent = parent
    ob.location = loc
    return ob


def sphere(name, radius=1.0, mat=None, parent=None, loc=(0, 0, 0), scale=(1, 1, 1), seg=64, rings=32):
    ob = mesh_obj(name, lambda bm: bmesh.ops.create_uvsphere(
        bm, u_segments=seg, v_segments=rings, radius=radius), mat, parent, loc)
    ob.scale = scale
    return ob


def cylinder_between(name, p1, p2, r, mat, parent=None):
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    ob = mesh_obj(name, lambda bm: bmesh.ops.create_cone(
        bm, cap_ends=True, segments=32, radius1=r, radius2=r, depth=d.length), mat, parent)
    ob.location = (p1 + p2) / 2
    ob.rotation_mode = "QUATERNION"
    ob.rotation_quaternion = d.to_track_quat("Z", "Y")
    return ob


def curve_obj(name, points, bevel, mat, parent=None, cyclic=False, kind="POLY", res=12):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = bevel
    cu.bevel_resolution = 6
    cu.use_fill_caps = True
    cu.resolution_u = res
    sp = cu.splines.new(kind)
    sp.points.add(len(points) - 1)
    for p, co in zip(sp.points, points):
        p.co = (co[0], co[1], co[2], 1.0)
    sp.use_cyclic_u = cyclic
    if kind == "NURBS":
        sp.use_endpoint_u = True
        sp.order_u = 3
    ob = bpy.data.objects.new(name, cu)
    link_obj(ob)
    if mat:
        cu.materials.append(mat)
    if parent:
        ob.parent = parent
    return ob


def circle_pts(r, n=128, plane="XZ"):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        if plane == "XZ":
            pts.append((r * math.cos(a), 0, r * math.sin(a)))
        else:
            pts.append((r * math.cos(a), r * math.sin(a), 0))
    return pts


def kf(target, path, frame, value, index=-1):
    if index >= 0:
        getattr(target, path)[index] = value
    else:
        setattr(target, path, value)
    target.keyframe_insert(data_path=path, frame=frame, index=index)


def kf_vec(obj, path, frame, value):
    setattr(obj, path, value)
    obj.keyframe_insert(data_path=path, frame=frame)


def kf_socket(socket, frame, value):
    socket.default_value = value
    socket.keyframe_insert("default_value", frame=frame)


def surface_point(center, r, az_deg, el_deg, inset=0.0):
    """Point on a sphere facing the camera (-Y), with outward normal."""
    az, el = math.radians(az_deg), math.radians(el_deg)
    n = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    return Vector(center) + n * (r - inset), n


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------
def principled(name, color, rough=0.4, metal=0.0, coat=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    set_input(b, "Base Color", hex_rgba(color))
    set_input(b, "Roughness", rough)
    set_input(b, "Metallic", metal)
    set_input(b, ["Coat Weight", "Clearcoat"], coat)
    set_input(b, ["Coat Roughness", "Clearcoat Roughness"], 0.05)
    if emit:
        set_input(b, ["Emission Color", "Emission"], hex_rgba(emit))
        set_input(b, "Emission Strength", emit_strength)
    return m


def emission(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = hex_rgba(color)
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def pillar_material(name, color, strength):
    """Emission that brightens toward the top of each bar."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.02, 0.03, 0.05, 1)
    ramp.color_ramp.elements[1].position = 1.0
    ramp.color_ramp.elements[1].color = hex_rgba(color)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    glossy = nt.nodes.new("ShaderNodeBsdfPrincipled")
    set_input(glossy, "Base Color", hex_rgba(SLATE_DEEP))
    set_input(glossy, "Roughness", 0.15)
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
    nt.links.new(glossy.outputs[0], add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    nt.links.new(add.outputs[0], out.inputs["Surface"])
    return m


def grid_floor_material():
    """Glossy dark floor with glowing grid lines that fade with distance."""
    m = bpy.data.materials.new("Floor_DataGrid")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    N, L = nt.nodes.new, nt.links.new
    out = N("ShaderNodeOutputMaterial")
    tc = N("ShaderNodeTexCoord")
    sep = N("ShaderNodeSeparateXYZ")
    L(tc.outputs["Object"], sep.inputs[0])

    def line(axis_out, spacing, width):
        div = N("ShaderNodeMath"); div.operation = "DIVIDE"; div.inputs[1].default_value = spacing
        fr = N("ShaderNodeMath"); fr.operation = "FRACT"
        sub = N("ShaderNodeMath"); sub.operation = "SUBTRACT"; sub.inputs[1].default_value = 0.5
        ab = N("ShaderNodeMath"); ab.operation = "ABSOLUTE"
        gt = N("ShaderNodeMath"); gt.operation = "GREATER_THAN"; gt.inputs[1].default_value = 0.5 - width
        L(axis_out, div.inputs[0]); L(div.outputs[0], fr.inputs[0]); L(fr.outputs[0], sub.inputs[0])
        L(sub.outputs[0], ab.inputs[0]); L(ab.outputs[0], gt.inputs[0])
        return gt.outputs[0]

    gx = line(sep.outputs["X"], 1.0, 0.012)
    gy = line(sep.outputs["Y"], 1.0, 0.012)
    mx = N("ShaderNodeMath"); mx.operation = "MAXIMUM"
    L(gx, mx.inputs[0]); L(gy, mx.inputs[1])

    # radial fade: 1 near the centre, 0 far away
    ln = N("ShaderNodeVectorMath"); ln.operation = "LENGTH"
    L(tc.outputs["Object"], ln.inputs[0])
    fade = N("ShaderNodeMapRange")
    fade.inputs["From Min"].default_value = 3.0
    fade.inputs["From Max"].default_value = 22.0
    fade.inputs["To Min"].default_value = 1.0
    fade.inputs["To Max"].default_value = 0.0
    L(ln.outputs["Value"], fade.inputs["Value"])
    mul = N("ShaderNodeMath"); mul.operation = "MULTIPLY"
    L(mx.outputs[0], mul.inputs[0]); L(fade.outputs["Result"], mul.inputs[1])

    pulse = N("ShaderNodeMath"); pulse.operation = "MULTIPLY"   # inputs[1] = animatable intensity
    pulse.inputs[1].default_value = 1.0
    L(mul.outputs[0], pulse.inputs[0])

    em = N("ShaderNodeEmission")
    em.inputs["Color"].default_value = hex_rgba("#3E6E9A")
    L(pulse.outputs[0], em.inputs["Strength"])

    bsdf = N("ShaderNodeBsdfPrincipled")
    set_input(bsdf, "Base Color", hex_rgba("#0A1119"))
    set_input(bsdf, "Roughness", 0.12)
    add = N("ShaderNodeAddShader")
    L(bsdf.outputs[0], add.inputs[0]); L(em.outputs[0], add.inputs[1])
    L(add.outputs[0], out.inputs["Surface"])
    return m, pulse


# --------------------------------------------------------------------------
# Scene reset & render settings
# --------------------------------------------------------------------------
def reset_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for coll in (bpy.data.objects, bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                 bpy.data.lights, bpy.data.cameras, bpy.data.worlds, bpy.data.actions):
        for block in list(coll):
            coll.remove(block)
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, FRAME_END
    sc.render.fps = FPS
    sc.frame_set(1)
    return sc


def render_settings(sc):
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in engines else "BLENDER_EEVEE"
    ee = sc.eevee
    for attr, val in (("taa_render_samples", RENDER_SAMPLES), ("use_raytracing", True),
                      ("use_shadows", True), ("volumetric_tile_size", "4"),
                      ("volumetric_samples", 96), ("use_volumetric_shadows", True),
                      ("volumetric_end", 60.0), ("use_gtao", True), ("use_bloom", True)):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, val)
            except Exception:
                pass
    sc.render.resolution_x, sc.render.resolution_y = RES_X, RES_Y
    sc.render.use_motion_blur = True
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Punchy"
    except Exception:
        pass
    sc.view_settings.exposure = 0.3

    sc.render.filepath = OUTPUT_PATH
    try:
        if hasattr(sc.render.image_settings, "media_type"):
            sc.render.image_settings.media_type = "VIDEO"
        sc.render.image_settings.file_format = "FFMPEG"
        sc.render.ffmpeg.format = "MPEG4"
        sc.render.ffmpeg.codec = "H264"
        sc.render.ffmpeg.constant_rate_factor = "HIGH"
    except Exception:
        sc.render.image_settings.file_format = "PNG"   # fallback: image sequence


def setup_bloom(sc):
    """Fog-glow bloom in the compositor (handles both the 4.x and 5.x compositor APIs)."""
    if hasattr(sc, "compositing_node_group"):              # Blender 5.x
        ng = bpy.data.node_groups.new("Clairvoyant_Comp", "CompositorNodeTree")
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        sc.compositing_node_group = ng
        out = ng.nodes.new("NodeGroupOutput")
        out_socket = out.inputs[0]
    else:                                                  # Blender 4.x
        sc.use_nodes = True
        ng = sc.node_tree
        ng.nodes.clear()
        out = ng.nodes.new("CompositorNodeComposite")
        out_socket = out.inputs["Image"]
    rl = ng.nodes.new("CompositorNodeRLayers")
    glare = ng.nodes.new("CompositorNodeGlare")
    if "Type" in glare.inputs:                             # 4.5+/5.x: options are sockets
        for v in ("Bloom", "BLOOM", "Fog Glow", "FOG_GLOW"):
            try:
                glare.inputs["Type"].default_value = v
                break
            except Exception:
                continue
        set_input(glare, "Threshold", 0.8)
        set_input(glare, "Strength", 0.9)
        set_input(glare, "Size", 0.75)
        try:
            glare.inputs["Quality"].default_value = "High"
        except Exception:
            pass
    else:
        glare.glare_type = "BLOOM" if "BLOOM" in [i.identifier for i in glare.bl_rna.properties["glare_type"].enum_items] else "FOG_GLOW"
        glare.threshold = 0.8
        glare.quality = "HIGH"
        if hasattr(glare, "size"):
            glare.size = 7
    lens = ng.nodes.new("CompositorNodeLensdist")
    set_input(lens, ["Dispersion", "Dispersion"], 0.012)
    set_input(lens, "Distortion", -0.01)
    ng.links.new(rl.outputs["Image"], glare.inputs["Image"])
    ng.links.new(glare.outputs[0], lens.inputs["Image"])
    ng.links.new(lens.outputs[0], out_socket)


# --------------------------------------------------------------------------
# Environment
# --------------------------------------------------------------------------
def build_world(sc):
    w = bpy.data.worlds.new("Clairvoyant_Night")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    # gradient sky: deep slate at the horizon to near-black overhead
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = hex_rgba("#1B2C3D")
    ramp.color_ramp.elements[1].position = 0.6
    ramp.color_ramp.elements[1].color = hex_rgba("#05080C")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.6
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    # atmospheric haze for light shafts
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = 0.018
    set_input(vol, "Color", hex_rgba("#9DB4CC"))
    set_input(vol, "Anisotropy", 0.35)
    nt.links.new(vol.outputs[0], out.inputs["Volume"])


def build_stage():
    floor_mat, grid_strength = grid_floor_material()
    floor = mesh_obj("Floor", lambda bm: bmesh.ops.create_grid(
        bm, x_segments=1, y_segments=1, size=40), floor_mat, smooth=False)


    # floating motes: one mesh of many tiny spheres, slowly rotating
    import random
    random.seed(7)

    def motes(bm):
        for _ in range(220):
            r = random.uniform(2.5, 14)
            a = random.uniform(0, 2 * math.pi)
            z = random.uniform(0.3, 7)
            s = random.uniform(0.01, 0.035)
            mat = Matrix.Translation((r * math.cos(a), r * math.sin(a), z))
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=s, matrix=mat)
    dust = mesh_obj("Floating_Motes", motes, emission("Mote_Glow", AMBER, 18.0), smooth=False)
    kf(dust, "rotation_euler", 1, 0.0, index=2)
    kf(dust, "rotation_euler", FRAME_END, math.radians(40), index=2)
    kf(dust, "location", 1, 0.0, index=2)
    kf(dust, "location", FRAME_END, 0.6, index=2)

    # distant monolith silhouettes for depth
    for i, (x, y, h) in enumerate([(-11, 14, 6), (-6, 18, 9), (7, 17, 7.5), (12, 13, 5), (1, 22, 11)]):
        mono = mesh_obj(f"Monolith_{i}", lambda bm: bmesh.ops.create_cube(bm, size=1.0),
                        principled(f"Monolith_Mat_{i}", "#0E1823", rough=0.3,
                                   emit="#2A4A6A", emit_strength=0.15), smooth=False)
        mono.scale = (1.2, 1.2, h)
        mono.location = (x, y, h / 2)
    return floor, grid_strength


def build_lights():
    def light(name, kind, loc, rot, energy, color, size=1.0, spot=None):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        ld.color = hex_rgba(color)[:3]
        if kind == "AREA":
            ld.size = size
        if kind == "SPOT" and spot:
            ld.spot_size = math.radians(spot)
            ld.spot_blend = 0.6
        if hasattr(ld, "use_shadow"):
            ld.use_shadow = True
        ob = bpy.data.objects.new(name, ld)
        ob.location = loc
        ob.rotation_euler = [math.radians(a) for a in rot]
        link_obj(ob)
        return ob

    light("Key_Warm", "AREA", (-4.5, -5.5, 5.5), (55, 0, -40), 900, "#FFE8CC", size=4)
    light("Rim_Ice_R", "AREA", (4.5, 3.5, 3.5), (-60, 0, 130), 1200, "#7FC4FF", size=2)
    light("Rim_Ice_L", "AREA", (-4.5, 3.0, 2.5), (-65, 0, -130), 700, "#5AA0E6", size=2)
    shaft = light("God_Ray_Spot", "SPOT", (1.5, 4.0, 11), (-20, 8, 0), 9000, "#DDEBFF", spot=34)
    return shaft


# --------------------------------------------------------------------------
# Orb the mascot
# --------------------------------------------------------------------------
def build_orb():
    m_body = principled("Orb_Body", "#46647F", rough=0.3, coat=0.8)  # brand slate, lifted for 3D lighting
    m_white = principled("Orb_EyeWhite", "#F4F7FA", rough=0.25, coat=0.5)
    m_pupil = principled("Orb_Pupil", "#0B1118", rough=0.08, coat=1.0)
    m_shine = emission("Orb_EyeShine", "#FFFFFF", 6.0)
    m_blush = principled("Orb_Blush", BLUSH, rough=0.6, emit=BLUSH, emit_strength=0.4)
    m_amber = emission("Orb_Amber", AMBER, 12.0)
    m_mouth = principled("Orb_Mouth", "#0B1118", rough=0.4)

    root = new_empty("Orb_Root", (0, 0, 0), size=0.8)
    # body pivot sits at the bottom of the sphere so squash keeps him grounded
    body = new_empty("Orb_Body_Ctrl", (0, 0, 0.85), parent=root, size=0.5)
    R = 1.0
    C = Vector((0, 0, R))      # sphere centre in body space

    sphere("Orb_Sphere", R, m_body, body, C)

    # eyes: a control empty per eye (blink = scale Z), white, pupil, two shines
    eyes, pupils = [], []
    for side, az in (("L", -24), ("R", 24)):
        p, n = surface_point(C, R, az, 14, inset=0.06)
        ctrl = new_empty(f"Orb_Eye_{side}", p, body, size=0.2)
        ctrl.rotation_mode = "QUATERNION"
        ctrl.rotation_quaternion = n.to_track_quat("-Y", "Z")
        sphere(f"Orb_EyeWhite_{side}", 1.0, m_white, ctrl, (0, 0, 0), (0.27, 0.13, 0.31))
        pup = new_empty(f"Orb_PupilCtrl_{side}", (0, -0.06, 0), ctrl, size=0.1)
        sphere(f"Orb_Pupil_{side}", 1.0, m_pupil, pup, (0, 0, 0), (0.16, 0.11, 0.19))
        sphere(f"Orb_Shine_{side}", 1.0, m_shine, pup, (0.06, -0.1, 0.08), (0.05, 0.03, 0.05), seg=16, rings=8)
        sphere(f"Orb_Shine2_{side}", 1.0, m_shine, pup, (-0.05, -0.1, -0.07), (0.022, 0.015, 0.022), seg=12, rings=6)
        eyes.append(ctrl)
        pupils.append(pup)

    # cheeks
    for side, az in (("L", -46), ("R", 46)):
        p, n = surface_point(C, R, az, -6, inset=0.035)
        b = sphere(f"Orb_Blush_{side}", 1.0, m_blush, body, p, (0.15, 0.04, 0.08), seg=24, rings=12)
        b.rotation_mode = "QUATERNION"
        b.rotation_quaternion = n.to_track_quat("-Y", "Z")

    # smile (a soft curve hugging the sphere)
    pts = [surface_point(C, R + 0.005, az, el)[0] for az, el in ((-15, -12), (-7, -19), (0, -21), (7, -19), (15, -12))]
    curve_obj("Orb_Smile", pts, 0.03, m_mouth, body, kind="NURBS")

    # antenna: the logo's amber breakout line, now a springy stalk
    p, n = surface_point(C, R, 28, 58, inset=0.05)
    ant = new_empty("Orb_Antenna_Root", p, body, size=0.2)
    curve_obj("Orb_Antenna_Stalk", [(0, 0, 0), (0.12, -0.02, 0.35), (0.42, -0.05, 0.62)],
              0.035, m_amber, ant, kind="NURBS")
    tip = sphere("Orb_Antenna_Tip", 0.13, m_amber, ant, (0.45, -0.05, 0.66), seg=32, rings=16)
    tl = bpy.data.lights.new("Antenna_Glow", "POINT")
    tl.energy = 60
    tl.color = hex_rgba(AMBER)[:3]
    tl.shadow_soft_size = 0.15
    tlo = bpy.data.objects.new("Antenna_Glow", tl)
    tlo.parent = tip
    link_obj(tlo)

    # legs: the logo's V, now two chunky legs with bean feet
    legs, feet = [], []
    for side, sx in (("L", -1), ("R", 1)):
        legs.append(cylinder_between(f"Orb_Leg_{side}", (0.28 * sx, 0, 1.05), (0.42 * sx, -0.02, 0.2), 0.11, m_body, root))
        foot = sphere(f"Orb_Foot_{side}", 1.0, m_body, root, (0.45 * sx, -0.12, 0.13), (0.24, 0.34, 0.14))
        foot.rotation_euler.z = math.radians(-12 * sx)
        feet.append(foot)

    return dict(root=root, body=body, eyes=eyes, pupils=pupils, antenna=ant,
                tip=tip, tip_mat=m_amber, tip_light=tl, legs=legs, feet=feet, body_mat=m_body)



def vis(ob, frame, visible):
    ob.hide_render = not visible
    ob.hide_viewport = not visible
    ob.keyframe_insert("hide_render", frame=frame)
    ob.keyframe_insert("hide_viewport", frame=frame)


def letter_curve(name, ch, em, mat, parent):
    adv, contours = MICHROMA[ch]
    k = em / MICHROMA_UPM
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.extrude = 0.018
    cu.bevel_depth = 0.004
    cu.resolution_u = 16
    for cont in contours:
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(cont) - 1)
        for bp, (a, hl, hr) in zip(sp.bezier_points, cont):
            bp.handle_left_type = "FREE"
            bp.handle_right_type = "FREE"
            bp.co = (a[0] * k, a[1] * k, 0)
            bp.handle_left = (hl[0] * k, hl[1] * k, 0)
            bp.handle_right = (hr[0] * k, hr[1] * k, 0)
        sp.use_cyclic_u = True
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    link_obj(ob)
    ob.parent = parent
    ob.rotation_euler.x = math.radians(90)      # stand the letter up in the logo plane, facing -Y
    return ob, adv * k



# ==========================================================================
# THE STORY
# ==========================================================================
# Key points in logo-root space (metres). The chart = the logo's four bars.
BAR_X = [LX(163), LX(179), LX(195), LX(211)]          # bar centres
BAR_TOP = [LZ(132), LZ(124), LZ(116), LZ(106)]       # bar tops (last = amber)
BREAK_A = Vector((LX(211), 0, LZ(106)))             # breakout line start (amber bar top)
DOT = Vector((LX(258), 0, LZ(87)))                  # breakout point = where Orb catches the spark
ORB_CENTRE = (0.85 + 1.0) * ORB_SCALE               # body centre height above Orb's feet
START_X = -8.0

# Beat frames (30 fps)
F_POP = 32          # antenna tip pops off
F_CHASE = 62
F_CLIMB = 100
F_STUMBLE = 160
F_EDGE = 212
F_FORESIGHT = 252
F_LEAP = 300
F_CATCH = 330
F_REVEAL = 348
F_MELT = 412
F_TITLE = 440


def linear_keys(on=True):
    """New keyframes default to LINEAR while on (keeps the spark and its trail in sync)."""
    edit = bpy.context.preferences.edit
    if on:
        linear_keys.prev = edit.keyframe_new_interpolation_type
        edit.keyframe_new_interpolation_type = "LINEAR"
    else:
        edit.keyframe_new_interpolation_type = getattr(linear_keys, "prev", "BEZIER")


def build_logo_parts(root):
    """Every element of the official stacked lockup, at 12x scale, parented to root."""
    m_white = principled("Logo_White", LOGO_WHITE, rough=0.3, emit=LOGO_WHITE, emit_strength=1.6)
    m_amber = emission("Logo_Amber", AMBER, 3.0)
    L = {"white": m_white, "amber": m_amber}

    def tube(name, pts, stroke, mat):
        ob = curve_obj(name, pts, stroke * S_LOGO / 2, mat, parent=root)
        ob.data.bevel_factor_mapping_start = "SPLINE"
        ob.data.bevel_factor_mapping_end = "SPLINE"
        return ob

    # chart bars: blue "data" while Orb climbs, they turn brand-white at the reveal
    L["bars"], L["bar_mats"] = [], []
    for i, (bx, bh) in enumerate(((158, 18), (174, 26), (190, 34), (206, 44))):
        amber = i == 3
        mat = m_amber if amber else principled(f"Chart_Bar_{i}", "#5FA8E8", rough=0.25,
                                               emit="#5FA8E8", emit_strength=1.2)

        def cube(bm):
            bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.translate(bm, vec=(0, 0, 0.5), verts=bm.verts)
        bar = mesh_obj(f"Chart_Bar_{i}", cube, mat, root, (LX(bx + 5), 0, 0), smooth=False)
        bar.scale = (10 * S_LOGO, 0.8, bh * S_LOGO)
        bev = bar.modifiers.new("Bevel", "BEVEL")
        bev.width = 0.03
        bev.segments = 3
        L["bars"].append(bar)
        if not amber:
            L["bar_mats"].append(mat)

    def ring(name, r, stroke):
        ob = tube(name, circle_pts(r, 160, "XZ"), stroke, m_white)
        ob.location = (0, 0, LZ(115))
        return ob
    L["ring"] = ring("Logo_Ring", 56 * S_LOGO, 12)
    L["inner"] = ring("Logo_Inner_Ring", 42 * S_LOGO, 2)
    L["gap_outer"] = math.degrees(math.atan2(115 - 84, 236 - 190)) / 360.0
    L["gap_inner"] = math.degrees(math.atan2(115 - 91, 225 - 190)) / 360.0
    L["baseline"] = tube("Logo_Baseline", [(LX(152), 0, LZ(150)), (LX(228), 0, LZ(150))], 2, m_white)
    L["breakout"] = tube("Logo_Breakout", [tuple(BREAK_A), tuple(DOT)], 3, m_amber)
    L["dot"] = sphere("Logo_Breakout_Point", 5 * S_LOGO, m_amber, root, tuple(DOT), seg=32, rings=16)
    L["v"] = tube("Logo_V_Stand", [(LX(148), 0, LZ(168)), (LX(190), 0, LZ(210)), (LX(232), 0, LZ(168))], 6, m_white)
    L["ground"] = tube("Logo_Groundline", [(LX(158), 0, LZ(218)), (LX(222), 0, LZ(218))], 6, m_white)

    # wordmark: Michroma, 7% tracking, centred under the mark exactly as in the stacked lockup
    em = (40 / 2.25) * S_LOGO
    track = 0.07 * em
    text = "CLAIRVOYANT"
    width = sum(MICHROMA[c][0] for c in text) * em / MICHROMA_UPM + track * (len(text) - 1)
    cap = MICHROMA_CAP / MICHROMA_UPM * em
    base_z = LZ(221) - (46 / 2.25) * S_LOGO - cap
    x = LX(195.5) - width / 2
    L["letters"] = []
    for i, ch in enumerate(text):
        ob, adv = letter_curve(f"Logo_Letter_{i:02d}_{ch}", ch, em, m_white, root)
        ob.data.extrude = 0.08
        ob.location = (x, 0, base_z)
        L["letters"].append(ob)
        x += adv + track
    L["word_base_z"] = base_z

    if TAGLINE:
        cu = bpy.data.curves.new("Tagline", "FONT")
        cu.body = TAGLINE
        cu.align_x = "CENTER"
        cu.size = 0.62
        cu.space_character = 1.1
        tm = emission("Tagline_Glow", "#9CACBC", 0.0)
        cu.materials.append(tm)
        tg = bpy.data.objects.new("Tagline", cu)
        link_obj(tg)
        tg.parent = root
        tg.rotation_euler.x = math.radians(90)
        tg.location = (LX(195.5), 0, base_z - 1.9)
        L["tagline_strength"] = tm.node_tree.nodes["Emission"].inputs["Strength"]
        L["tagline"] = tg
    return L


def ring_shockwave(name, centre, frame, max_r, parent, plane="XZ"):
    mat = emission(f"{name}_Mat", ICE, 0.0)
    ob = curve_obj(name, circle_pts(1.0, 96, plane), 0.03, mat, parent=parent, cyclic=True)
    ob.location = centre
    s = mat.node_tree.nodes["Emission"].inputs["Strength"]
    for f, r, e in ((1, 0.001, 0.0), (frame - 1, 0.001, 0.0), (frame, 0.2, 30.0), (frame + 24, max_r, 0.0)):
        kf_vec(ob, "scale", f, (r, r, r))
        kf_socket(s, f, e)
    return ob


# --------------------------------------------------------------------------
# Orb choreography
# --------------------------------------------------------------------------
class Choreo:
    def __init__(self, orb):
        self.o = orb
        self.root, self.body = orb["root"], orb["body"]

    def at(self, f, x, z):
        kf_vec(self.root, "location", f, (x, 0, z))

    def face(self, f, deg):
        kf(self.root, "rotation_euler", f, math.radians(deg), index=2)

    def lean(self, f, deg):
        kf(self.body, "rotation_euler", f, math.radians(deg), index=1)

    def squash(self, f, sxy, sz):
        kf_vec(self.body, "scale", f, (sxy, sxy, sz))

    def hop(self, f0, f1, p0, p1, extra=0.8):
        """Jump from p0=(x,z) at f0 to p1 at f1 with squash and stretch."""
        mid = (f0 + f1) // 2
        self.at(f0, *p0)
        self.at(mid, (p0[0] + p1[0]) / 2, max(p0[1], p1[1]) + extra)
        self.at(f1, *p1)
        self.squash(f0 - 3, 1.15, 0.84)
        self.squash(f0 + 2, 0.88, 1.18)
        self.squash(mid, 0.97, 1.04)
        self.squash(f1, 1.22, 0.78)
        self.squash(f1 + 5, 1.0, 1.0)

    def look(self, f, x, z):
        for p in self.o["pupils"]:
            kf_vec(p, "location", f, (x, -0.06, z))

    def eyes(self, f, sx, sz):
        for e in self.o["eyes"]:
            kf_vec(e, "scale", f, (sx, 1, sz))

    def blink(self, f):
        self.eyes(f, 1, 1)
        self.eyes(f + 3, 1.05, 0.08)
        self.eyes(f + 6, 1, 1)

    def wobble(self, frames_angles):
        for f, a in frames_angles:
            kf(self.o["antenna"], "rotation_euler", f, math.radians(a), index=1)


def animate_story(sc, orb, L, root):
    c = Choreo(orb)
    o = orb
    o["root"].scale = (ORB_SCALE,) * 3
    tl = o["tip_light"]
    tl.energy = 25
    floor_z = 0.0

    # ---- 1. IDLE: antenna starts to twitch ---------------------------------
    c.at(1, START_X, floor_z)
    c.face(1, 0)
    c.squash(1, 1, 1)
    c.lean(1, 0)
    c.look(1, 0, 0)
    c.eyes(1, 1, 1)
    c.blink(14)
    c.look(18, 0.08, 0.1)                      # glances up at the antenna
    c.wobble([(1, 0), (20, 0), (23, 14), (25, -12), (27, 18), (29, -16), (31, 22)])

    # ---- 2. POP: the tip detaches and becomes the spark --------------------
    tip = o["tip"]
    kf_vec(tip, "scale", 1, (1, 1, 1))
    kf_vec(tip, "scale", F_POP - 1, (1, 1, 1))
    kf_vec(tip, "scale", F_POP, (0, 0, 0))
    for f, e in ((1, 25), (F_POP - 1, 25), (F_POP, 0)):
        kf(tl, "energy", f, e)
    c.wobble([(F_POP, -30), (F_POP + 4, 20), (F_POP + 9, -10), (F_POP + 14, 0)])
    c.eyes(F_POP + 2, 1.25, 1.25)               # wide-eyed surprise
    c.look(F_POP + 4, 0.1, 0.12)
    c.squash(F_POP + 2, 0.9, 1.15)
    c.squash(F_POP + 8, 1.0, 1.0)
    c.at(F_POP + 6, START_X - 0.15, 0.25)       # little startled jump back
    c.at(F_POP + 12, START_X - 0.2, floor_z)

    sc.frame_set(F_POP - 1)
    tip_world = root.matrix_world.inverted() @ tip.matrix_world.translation

    spark = sphere("Spark", 0.11, emission("Spark_Glow", AMBER, 30.0), root, tuple(tip_world), seg=24, rings=12)
    sl = bpy.data.lights.new("Spark_Light", "POINT")
    sl.color = hex_rgba(AMBER)[:3]
    sl.shadow_soft_size = 0.1
    slo = bpy.data.objects.new("Spark_Light", sl)
    slo.parent = spark
    link_obj(slo)
    for f, s_ in ((1, 0), (F_POP - 1, 0), (F_POP, 1.4), (F_POP + 6, 1.0)):
        kf_vec(spark, "scale", f, (s_, s_, s_))
    for f, e in ((1, 0), (F_POP - 1, 0), (F_POP, 150), (F_POP + 10, 80)):
        kf(sl, "energy", f, e)

    # spark flight = the line chart; the trail follows it exactly
    above = 0.55
    path = [(F_POP, tip_world),
            (F_POP + 14, Vector((-6.4, 0, 2.4))),
            (F_CHASE, Vector((-4.6, 0, 1.2))),
            (F_CHASE + 22, Vector((BAR_X[0], 0, BAR_TOP[0] + above))),
            (F_CLIMB + 10, Vector((BAR_X[1], 0, BAR_TOP[1] + above))),
            (F_CLIMB + 28, Vector((BAR_X[2], 0, BAR_TOP[2] + above))),
            (F_CLIMB + 46, Vector((BAR_X[3], 0, BAR_TOP[3] + above))),
            (F_CLIMB + 80, Vector((DOT.x + 0.8, 0, DOT.z + 3.4)))]      # up and away, past the end of the chart
    trail = curve_obj("Spark_Trail", [tuple(p) for _, p in path], 0.05,
                      emission("Spark_Trail_Glow", AMBER, 12.0), parent=root)
    trail.data.bevel_factor_mapping_end = "SPLINE"
    trail.data.bevel_factor_mapping_start = "SPLINE"
    seg = [0.0]
    for (_, a), (_, b) in zip(path, path[1:]):
        seg.append(seg[-1] + (b - a).length)
    linear_keys(True)
    kf(trail.data, "bevel_factor_end", 1, 0.0)
    for (f, p), d in zip(path, seg):
        kf_vec(spark, "location", f, tuple(p))
        kf(trail.data, "bevel_factor_end", f, d / seg[-1])
    linear_keys(False)
    hover = path[-1][1]
    for i, f in enumerate(range(path[-1][0] + 10, F_LEAP, 14)):        # it hovers out in the void
        kf_vec(spark, "location", f, tuple(hover + Vector((0.1 * (-1) ** i, 0, 0.18 * (-1) ** i))))

    # ---- 3. CHASE: waddle-hops across the floor -----------------------------
    c.face(F_CHASE - 4, 0)
    c.face(F_CHASE + 2, 55)                     # turn toward the run
    c.eyes(F_CHASE, 1, 0.82)                    # determined squint
    c.look(F_CHASE, 0.08, 0.04)
    c.lean(F_CHASE + 2, 10)
    xs = [START_X - 0.2, -7.2, -6.2, -5.2, -4.2, -3.3]
    for i in range(len(xs) - 1):
        f0 = F_CHASE + 3 + i * 7
        c.hop(f0, f0 + 7, (xs[i], 0), (xs[i + 1], 0), extra=0.22)

    # ---- 4. CLIMB: bar to bar -----------------------------------------------
    c.lean(F_CLIMB - 4, 0)
    c.hop(F_CLIMB, F_CLIMB + 12, (xs[-1], 0), (BAR_X[0], BAR_TOP[0]), extra=0.9)
    c.hop(F_CLIMB + 20, F_CLIMB + 32, (BAR_X[0], BAR_TOP[0]), (BAR_X[1], BAR_TOP[1]), extra=0.8)
    c.hop(F_CLIMB + 40, F_CLIMB + 52, (BAR_X[1], BAR_TOP[1]), (BAR_X[2], BAR_TOP[2]), extra=0.8)
    c.wobble([(F_CLIMB + 12, -15), (F_CLIMB + 16, 10), (F_CLIMB + 32, -15), (F_CLIMB + 36, 10), (F_CLIMB + 52, -12), (F_CLIMB + 58, 0)])

    # ---- 5. STUMBLE: the biggest step, he comes up short ---------------------
    edge_x = LX(206) - ORB_SCALE - 0.04            # in the gap, just short of the amber bar
    hang_z = BAR_TOP[3] - 0.9
    c.at(F_STUMBLE, BAR_X[2], BAR_TOP[2])
    c.squash(F_STUMBLE - 3, 1.15, 0.84)
    c.at(F_STUMBLE + 7, (BAR_X[2] + edge_x) / 2, BAR_TOP[3] + 0.25)
    c.at(F_STUMBLE + 13, edge_x, hang_z)        # slams into the side, hanging off the edge
    c.squash(F_STUMBLE + 13, 0.85, 1.2)
    c.eyes(F_STUMBLE + 9, 1.3, 1.3)
    c.look(F_STUMBLE + 9, 0.0, 0.12)
    for f, a in ((F_STUMBLE, 0), (F_STUMBLE + 13, -28), (F_STUMBLE + 18, -14), (F_STUMBLE + 23, -30),
                 (F_STUMBLE + 28, -16), (F_STUMBLE + 33, -26)):
        c.lean(f, a)                             # flailing
    c.at(F_STUMBLE + 30, edge_x, hang_z + 0.12)
    c.at(F_STUMBLE + 36, edge_x, hang_z)         # slips a little
    # scramble up
    c.at(F_STUMBLE + 42, edge_x + 0.15, BAR_TOP[3] - 0.15)
    c.lean(F_STUMBLE + 42, -10)
    c.at(F_STUMBLE + 48, BAR_X[3], BAR_TOP[3])
    c.lean(F_STUMBLE + 48, 0)
    c.squash(F_STUMBLE + 48, 1.15, 0.85)
    c.squash(F_STUMBLE + 52, 1.0, 1.0)
    c.eyes(F_STUMBLE + 46, 1, 1)
    c.blink(F_EDGE - 6)

    # ---- 6. THE EDGE: the spark is out in the void ----------------------------
    c.at(F_EDGE, BAR_X[3], BAR_TOP[3])
    c.face(F_EDGE, 55)
    c.face(F_EDGE + 12, 70)
    c.look(F_EDGE + 8, 0.1, 0.1)
    c.lean(F_EDGE + 10, 6)
    c.lean(F_FORESIGHT - 8, 0)
    c.face(F_FORESIGHT - 4, 70)
    c.face(F_FORESIGHT + 6, 35)

    # ---- 7. FORESIGHT: eyes close, he glows, the forecast projects ------------
    b = o["body_mat"].node_tree.nodes["Principled BSDF"]
    set_input(b, ["Emission Color", "Emission"], hex_rgba(LOGO_WHITE))
    es = b.inputs["Emission Strength"]
    bc = b.inputs["Base Color"]
    slate = bc.default_value[:]
    for f, e in ((1, 0.0), (F_FORESIGHT, 0.0), (F_FORESIGHT + 22, 2.5), (F_LEAP + 4, 2.5), (F_CATCH, 1.0)):
        kf_socket(es, f, e)
    c.eyes(F_FORESIGHT + 2, 1, 1)
    c.eyes(F_FORESIGHT + 8, 1.08, 0.07)
    c.squash(F_FORESIGHT + 10, 1.0, 1.0)
    c.squash(F_FORESIGHT + 24, 1.05, 1.05)        # a slow breath in

    m_dash = emission("Forecast_Dash", AMBER, 8.0)
    n = 11
    dashes = []
    for i in range(n):
        a = BREAK_A + (DOT - BREAK_A) * ((i + 0.15) / n)
        e = BREAK_A + (DOT - BREAK_A) * ((i + 0.65) / n)
        a.y = e.y = -0.05
        d = cylinder_between(f"Forecast_Dash_{i:02d}", a, e, 0.06, m_dash, root)
        f0 = F_FORESIGHT + 14 + i * 2
        kf_vec(d, "scale", 1, (0, 0, 0))
        kf_vec(d, "scale", f0, (0, 0, 0))
        kf_vec(d, "scale", f0 + 4, (1, 1, 1))
        dashes.append(d)
    ghost = curve_obj("Forecast_Target", circle_pts(0.45, 48, "XZ"), 0.025, m_dash, parent=root, cyclic=True)
    ghost.location = tuple(DOT + Vector((0, -0.05, 0)))
    for f, s_ in ((1, 0), (F_FORESIGHT + 36, 0), (F_FORESIGHT + 40, 1.2), (F_FORESIGHT + 46, 0.9),
                  (F_FORESIGHT + 52, 1.1), (F_LEAP, 0.9), (F_CATCH, 0.9), (F_CATCH + 2, 0)):
        kf_vec(ghost, "scale", f, (s_, s_, s_))

    # ---- 8. LEAP OF FAITH ------------------------------------------------------
    c.eyes(F_LEAP - 2, 1, 0.07)
    c.eyes(F_LEAP + 2, 1, 0.85)
    c.face(F_LEAP - 4, 35)
    c.squash(F_LEAP - 4, 1.2, 0.75)               # crouch
    c.at(F_LEAP, BAR_X[3], BAR_TOP[3])
    catch_root = DOT - Vector((0, 0, ORB_CENTRE))
    c.at(F_LEAP + 15, (BAR_X[3] + DOT.x) / 2 - 0.3, DOT.z + 1.0)
    c.at(F_CATCH, catch_root.x, catch_root.z)
    c.squash(F_LEAP + 3, 0.82, 1.25)
    c.squash(F_LEAP + 14, 1.0, 1.0)
    c.face(F_CATCH - 4, 0)                        # turns to camera as he arrives
    c.look(F_LEAP + 4, 0.1, 0.06)
    c.look(F_CATCH - 2, 0, 0)

    sc.frame_set(F_CATCH)
    tip_at_catch = root.matrix_world.inverted() @ tip.matrix_world.translation
    kf_vec(spark, "location", F_LEAP, tuple(hover))
    kf_vec(spark, "location", F_LEAP + 16, tuple(hover + Vector((0.4, 0, 0.6))))
    kf_vec(spark, "location", F_CATCH, tuple(tip_at_catch))
    kf_vec(spark, "scale", F_CATCH, (1, 1, 1))
    kf_vec(spark, "scale", F_CATCH + 1, (0, 0, 0))
    kf(sl, "energy", F_CATCH, 80)
    kf(sl, "energy", F_CATCH + 1, 0)

    # ---- 9. THE CATCH ------------------------------------------------------------
    kf_vec(tip, "scale", F_CATCH, (0, 0, 0))
    kf_vec(tip, "scale", F_CATCH + 1, (1.8, 1.8, 1.8))
    kf_vec(tip, "scale", F_CATCH + 8, (1, 1, 1))
    tip_strength = o["tip_mat"].node_tree.nodes["Emission"].inputs["Strength"]
    for f, e in ((1, 12), (F_CATCH, 12), (F_CATCH + 1, 80), (F_CATCH + 14, 12)):
        kf_socket(tip_strength, f, e)
    for f, e in ((F_CATCH, 0), (F_CATCH + 1, 600), (F_CATCH + 16, 25)):
        kf(tl, "energy", f, e)
    c.eyes(F_CATCH + 2, 1.08, 0.07)               # happy closed eyes
    c.squash(F_CATCH + 1, 1.25, 0.8)
    c.squash(F_CATCH + 7, 0.95, 1.06)
    c.squash(F_CATCH + 12, 1.0, 1.0)
    c.wobble([(F_CATCH, 0), (F_CATCH + 3, 25), (F_CATCH + 7, -15), (F_CATCH + 11, 6), (F_CATCH + 15, 0)])
    for i, f in enumerate(range(F_CATCH + 14, F_MELT, 16)):                  # floats, gently bobbing
        c.at(f, catch_root.x, catch_root.z + (0.08 if i % 2 else 0.0))
    ring_shockwave("Catch_Shockwave", tuple(DOT + Vector((0, -0.1, 0))), F_CATCH + 1, 7.0, root)

    # forecast dashes become the solid breakout line
    for i, d in enumerate(dashes):
        f0 = F_CATCH + 2 + i
        kf_vec(d, "scale", f0, (1, 1, 1))
        kf_vec(d, "scale", f0 + 4, (0, 0, 0))
    bo = L["breakout"].data
    kf(bo, "bevel_factor_end", 1, 0.0)
    kf(bo, "bevel_factor_end", F_CATCH + 2, 0.0)
    kf(bo, "bevel_factor_end", F_CATCH + 14, 1.0)
    # the chase trail has done its job: it retracts
    kf(trail.data, "bevel_factor_start", 1, 0.0)
    kf(trail.data, "bevel_factor_start", F_CATCH + 6, 0.0)
    kf(trail.data, "bevel_factor_start", F_CATCH + 30, 1.0)

    # ---- 10. THE REVEAL: the scene was the logo ---------------------------------
    for key, gap, f0, f1 in (("ring", L["gap_outer"], F_REVEAL + 4, F_REVEAL + 40),
                             ("inner", L["gap_inner"], F_REVEAL + 16, F_REVEAL + 46)):
        d = L[key].data
        kf(d, "bevel_factor_start", 1, gap)
        kf(d, "bevel_factor_end", 1, gap)
        kf(d, "bevel_factor_end", f0, gap)
        kf(d, "bevel_factor_end", f1, 1 - gap)
    for key, f0, f1 in (("baseline", F_REVEAL, F_REVEAL + 14), ("v", F_REVEAL + 34, F_REVEAL + 52),
                        ("ground", F_REVEAL + 46, F_REVEAL + 58)):
        d = L[key].data
        kf(d, "bevel_factor_end", 1, 0.0)
        kf(d, "bevel_factor_end", f0, 0.0)
        kf(d, "bevel_factor_end", f1, 1.0)
    # the whole thing rises out of the floor, V stand and groundline emerging beneath it
    kf(root, "location", F_REVEAL + 6, 0.0, index=2)
    kf(root, "location", F_REVEAL + 60, LOGO_LIFT, index=2)
    # data-blue bars turn brand-white
    for m in L["bar_mats"]:
        bsdf = m.node_tree.nodes["Principled BSDF"]
        for name in ("Base Color", "Emission Color"):
            if name in bsdf.inputs:
                s = bsdf.inputs[name]
                kf_socket(s, F_REVEAL + 20, s.default_value[:])
                kf_socket(s, F_REVEAL + 44, hex_rgba(LOGO_WHITE))
        s = bsdf.inputs["Emission Strength"]
        kf_socket(s, F_REVEAL + 20, 1.2)
        kf_socket(s, F_REVEAL + 44, 1.6)
    ws = L["white"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]
    for f, e in ((1, 1.6), (F_REVEAL + 40, 1.6), (F_REVEAL + 44, 6.0), (F_REVEAL + 58, 1.6)):
        kf_socket(ws, f, e)

    # ---- 11. MELT INTO THE MARK -------------------------------------------------------
    kf_socket(bc, F_MELT, slate)
    kf_socket(bc, F_MELT + 12, hex_rgba(LOGO_WHITE))
    kf_socket(es, F_MELT, 1.0)
    kf_socket(es, F_MELT + 12, 8.0)
    for f, s_ in ((F_MELT, 1.0), (F_MELT + 10, 0.85), (F_MELT + 20, 0.4), (F_MELT + 26, 0.0)):
        s = ORB_SCALE * s_
        kf_vec(o["root"], "scale", f, (s, s, s))
        c.at(f, DOT.x, DOT.z - ORB_CENTRE * s_)      # shrink about his body centre (= the dot)
    dot = L["dot"]
    for f, s_ in ((1, 0), (F_MELT + 14, 0), (F_MELT + 26, 1.25), (F_MELT + 32, 1.0)):
        kf_vec(dot, "scale", f, (s_, s_, s_))
    ring_shockwave("Melt_Shockwave", tuple(DOT + Vector((0, -0.1, 0))), F_MELT + 26, 4.0, root)

    # ---- 12. TITLE --------------------------------------------------------------------
    for i, ob in enumerate(L["letters"]):
        f0 = F_TITLE + i * 2
        kf_vec(ob, "scale", 1, (0, 0, 0))
        kf_vec(ob, "scale", f0, (0, 0, 0))
        kf_vec(ob, "scale", f0 + 5, (1.15, 1.15, 1.15))
        kf_vec(ob, "scale", f0 + 9, (1, 1, 1))
    if "tagline_strength" in L:
        ts = L["tagline_strength"]
        kf_socket(ts, 1, 0.0)
        kf_socket(ts, F_TITLE + 26, 0.0)
        kf_socket(ts, F_TITLE + 44, 1.5)
        tg = L["tagline"]
        kf_vec(tg, "scale", 1, (0, 0, 0))
        kf_vec(tg, "scale", F_TITLE + 25, (0, 0, 0))
        kf_vec(tg, "scale", F_TITLE + 26, (1, 1, 1))


# --------------------------------------------------------------------------
# Camera
# --------------------------------------------------------------------------
def build_story_camera(sc):
    target = new_empty("Camera_Target", (START_X, 0, 0.6), size=0.4)
    cd = bpy.data.cameras.new("Camera")
    cd.lens = 40
    cd.clip_end = 400
    cd.dof.use_dof = True
    cd.dof.focus_object = target
    cam = bpy.data.objects.new("Camera", cd)
    link_obj(cam)
    sc.camera = cam
    con = cam.constraints.new("TRACK_TO")
    con.target = target
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"

    # final framing: whole lockup + tagline, front-on
    top = LZ(53) + LOGO_LIFT
    bottom = LZ(221) - (46 / 2.25) * S_LOGO - (MICHROMA_CAP / MICHROMA_UPM) * (40 / 2.25) * S_LOGO + LOGO_LIFT - (2.3 if TAGLINE else 0)
    centre_z = (top + bottom) / 2
    dist = ((top - bottom) / 0.62 / 2) / math.tan(math.atan(10.125 / 40))
    cx = LX(195.5)

    shots = [  # frame, camera location, target location
        (1, (START_X + 1.4, -6.5, 1.3), (START_X, 0, 0.6)),
        (F_POP - 2, (START_X + 1.0, -5.2, 1.1), (START_X, 0, 0.7)),
        (F_POP + 10, (START_X + 1.0, -6.0, 1.8), (-6.6, 0, 2.0)),          # whip toward the spark
        (F_POP + 22, (START_X + 1.0, -6.0, 1.4), (START_X, 0, 0.6)),       # snap back to Orb
        (F_CHASE + 10, (-6.5, -7.0, 1.6), (-6.4, 0, 0.8)),                 # side-on tracking
        (F_CLIMB, (-3.6, -8.0, 2.0), (-3.0, 0, 1.2)),
        (F_CLIMB + 30, (-1.5, -8.5, 3.0), (-1.0, 0, 2.4)),                  # crane up with the climb
        (F_STUMBLE, (0.2, -7.5, 3.6), (0.6, 0, 3.1)),
        (F_STUMBLE + 16, (1.0, -5.0, 3.4), (1.2, 0, 3.0)),                  # tight on the stumble
        (F_EDGE - 6, (1.2, -5.5, 3.9), (1.6, 0, 3.8)),
        (F_EDGE + 24, (3.5, -15.0, 5.2), (4.0, 0, 4.6)),                    # wide: tiny Orb, huge void
        (F_FORESIGHT + 6, (3.0, -12.0, 4.8), (3.6, 0, 4.6)),
        (F_LEAP - 4, (2.4, -7.5, 4.4), (2.6, 0, 4.4)),                      # slow push-in on the glow
        (F_LEAP + 14, (3.8, -8.5, 5.4), (4.3, 0, 5.2)),                     # arc with the leap
        (F_CATCH, (5.4, -6.5, 5.4), (5.6, 0, 5.2)),
        (F_REVEAL, (5.5, -5.6, 5.3), (5.6, 0, 5.2)),                        # hold on the catch
        (F_REVEAL + 30, (3.0, -24.0, 8.0), (2.0, 0, 6.0)),                  # fast pull-back
        (F_REVEAL + 64, (cx, -dist * 0.95, centre_z), (cx, 0, centre_z)),
        (F_MELT, (cx, -dist * 0.9, centre_z), (cx, 0, centre_z)),
        (F_MELT + 8, (DOT.x - 0.5, -dist * 0.4, DOT.z + LOGO_LIFT), (DOT.x - 0.5, 0, DOT.z + LOGO_LIFT)),   # close on the melt
        (F_MELT + 30, (DOT.x - 1.0, -dist * 0.45, DOT.z + LOGO_LIFT - 0.5), (DOT.x - 1.0, 0, DOT.z + LOGO_LIFT - 0.5)),
        (F_TITLE + 10, (cx, -dist, centre_z), (cx, 0, centre_z)),           # end card
        (FRAME_END, (cx, -dist * 0.97, centre_z), (cx, 0, centre_z)),
    ]
    for f, loc, tgt in shots:
        kf_vec(cam, "location", f, loc)
        kf_vec(target, "location", f, tgt)
    for f, v in ((1, 2.4), (F_REVEAL, 2.4), (F_REVEAL + 30, 11.0)):
        cd.dof.aperture_fstop = v
        cd.keyframe_insert("dof.aperture_fstop", frame=f)
    return cam


# --------------------------------------------------------------------------
# Build it all
# --------------------------------------------------------------------------
def main():
    sc = reset_scene()
    render_settings(sc)
    for attr, val in (("volumetric_end", 160.0),):
        if hasattr(sc.eevee, attr):
            setattr(sc.eevee, attr, val)
    build_world(sc)
    floor, grid_strength = build_stage()
    shaft = build_lights()

    root = new_empty("Story_Root", (0, 0, 0), size=1.5)     # everything that rises at the end
    orb = build_orb()
    orb["root"].parent = root
    L = build_logo_parts(root)
    animate_story(sc, orb, L, root)
    build_story_camera(sc)

    # thin the haze for the long end-card shot
    vol = sc.world.node_tree.nodes.get("Principled Volume")
    if vol:
        d = vol.inputs["Density"]
        kf_socket(d, 1, 0.018)
        kf_socket(d, F_REVEAL, 0.018)
        kf_socket(d, F_REVEAL + 40, 0.004)
    # grid pulses on the big beats, then calms for the end card
    for f, v in ((1, 0.6), (F_CATCH, 0.6), (F_CATCH + 2, 3.0), (F_CATCH + 30, 0.8),
                 (F_REVEAL + 44, 2.5), (F_REVEAL + 70, 0.6), (FRAME_END, 0.5)):
        kf_socket(grid_strength.inputs[1], f, v)
    # god-ray spotlight swells for the finale
    shaft.location = (1.5, 8.0, 26.0)
    for f, e in ((1, 6000), (F_REVEAL, 6000), (F_REVEAL + 50, 40000), (FRAME_END, 30000)):
        kf(shaft.data, "energy", f, e)

    setup_bloom(sc)
    sc.frame_set(1)
    print("Clairvoyant 'Orb chases the spark' scene built: %d frames. Space = preview, Ctrl+F12 = render." % FRAME_END)


main()
