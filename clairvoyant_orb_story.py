"""
Clairvoyant: "Orb chases the spark"  (Blender animation script, v2)
===================================================================

HOW TO RUN
  1. Open Blender 4.2 or newer (tested on 5.2). Start a NEW General file and
     save it somewhere (the video is written next to the .blend).
  2. Scripting tab > Text > Open... > pick this file > Run Script (or Alt+P).
     The scene is wiped and rebuilt (about 10-30 s).
  3. Back in Layout, look through the camera: View > Cameras > Active Camera
     (or the camera icon at the top right of the viewport).
  4. See it properly: switch viewport shading to Rendered (Z > Rendered, or the
     4th sphere icon), and in the shading dropdown set Compositor to "Always"
     for the glow. Solid mode only shows grey shapes.
  5. F12 renders one frame. Ctrl+F12 renders the MP4 (clairvoyant_orb_*.mp4).
  Draft quickly: set RENDER_SAMPLES = 16 and RES_X, RES_Y = 1280, 720 below.

STORY (560 frames @ 30 fps, about 18.7 s). Beat frames are the F_* constants.
  001  Idle: Orb's antenna tip twitches.
  032  The tip pops off and flies away, drawing a line chart that only ever rises.
       The bars grow out of the floor as the line passes over them.
  062  The chase: Orb runs after it.
  100  He climbs the bars (the logo's four KPI bars at 12x), feeling every jump:
       psych up, strain, brace for impact, relief.
  188  The biggest step: he lands right on the edge of the amber bar and teeters.
  226  On top, the spark is slowly drawing the breakout line upward, out of reach.
       He jumps for it, falls well short, slumps.
  262  Foresight: eyes closed, he glows; forecast dashes project ahead of the line.
  294  He outruns the line: leaps over the spark and hops along the forecast dashes
       to the end, then turns and waits, bouncing.
  345  The spark reaches him and snaps back on: happy eyes, grin, sparkles, a
       spinning jump for joy.
  400  The reveal: the C ring draws round the chart and everything rises as the
       V stand and groundline emerge. He looks down at what he drew.
  464  Orb melts into the breakout point.
  492  The official CLAIRVOYANT wordmark (Michroma outlines, embedded) and tagline.
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
FRAME_END = 560
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
# Key points in story-root space (metres). The chart = the logo's four bars.
BAR_X = [LX(163), LX(179), LX(195), LX(211)]          # bar centres
BAR_TOP = [LZ(132), LZ(124), LZ(116), LZ(106)]       # bar tops (last = amber)
BREAK_A = Vector((LX(211), 0, LZ(106)))             # breakout line start (amber bar top)
DOT = Vector((LX(258), 0, LZ(87)))                  # breakout point
ORB_CENTRE = (0.85 + 1.0) * ORB_SCALE               # body centre height above Orb's feet
START_X = -8.2
LINE_R = 1.5 * S_LOGO                               # breakout line tube radius
DASH_R = 0.09

# Beat frames (30 fps). Change these to retime the film.
F_POP = 32           # antenna tip pops off and starts drawing the line
F_CHASE = 62         # Orb runs after it
F_CLIMB = 100        # first jump onto a bar
F_TEETER = 188       # lands on the very edge of the amber bar
F_EDGE = 226         # on top; the spark keeps climbing out of reach
F_FORESIGHT = 262    # eyes close, forecast dashes project ahead of the spark
F_LEAP = 294         # he outruns the line, hopping along the forecast
F_CATCH = 345        # the spark reaches him and snaps back on
F_REVEAL = 400       # the scene turns out to be the logo
F_MELT = 464         # Orb melts into the breakout point
F_TITLE = 492        # wordmark and tagline


def line_pt(frac):
    """Point on the breakout line (amber bar top -> breakout point)."""
    return BREAK_A + (DOT - BREAK_A) * frac


# How far the spark has drawn the breakout line, over time (only ever grows).
SPARK_FRAC = [(150, 0.0), (200, 0.2), (230, 0.29), (260, 0.37), (294, 0.45), (308, 0.53),
              (320, 0.63), (332, 0.76), (342, 0.95)]
DASH_FRACS = [0.53, 0.62, 0.71, 0.80, 0.89, 0.98]   # forecast dashes = Orb's stepping stones


def frame_for_frac(fr):
    for (f0, a), (f1, b) in zip(SPARK_FRAC, SPARK_FRAC[1:]):
        if a <= fr <= b:
            return f0 + (f1 - f0) * (fr - a) / (b - a)
    return SPARK_FRAC[-1][0]


def linear_keys(on=True):
    """New keyframes default to LINEAR while on (keeps the spark and its line in sync)."""
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




# --------------------------------------------------------------------------
# Face rig: brows, mouth shapes and happy ^^ eyes on top of the base Orb
# --------------------------------------------------------------------------
def add_face_rig(orb):
    body = orb["body"]
    C, R = Vector((0, 0, 1.0)), 1.0
    ink = principled("Orb_Ink", "#0B1118", rough=0.4)
    tongue = principled("Orb_Tongue", "#E86A6A", rough=0.5)

    def oriented_empty(name, az, el, inset=0.0):
        p, n = surface_point(C, R, az, el, inset=inset)
        e = new_empty(name, p, body, size=0.1)
        e.rotation_mode = "QUATERNION"
        e.rotation_quaternion = n.to_track_quat("-Y", "Z")
        return e

    # brows: a rotate-able bar above each eye
    brows = {}
    for side, az in (("L", -24), ("R", 24)):
        base = oriented_empty(f"Orb_BrowBase_{side}", az, 41, inset=-0.005)
        rot = new_empty(f"Orb_Brow_{side}", (0, 0, 0), base, size=0.08)
        cylinder_between(f"Orb_BrowBar_{side}", (-0.15, -0.02, 0), (0.15, -0.02, 0), 0.04, ink, rot)
        brows[side] = rot

    # happy ^ eyes (hidden until needed)
    happy = []
    for side, az in (("L", -24), ("R", 24)):
        base = oriented_empty(f"Orb_HappyEye_{side}", az, 14, inset=-0.01)
        curve_obj(f"Orb_HappyEyeArc_{side}", [(-0.17, -0.02, -0.05), (0, -0.02, 0.12), (0.17, -0.02, -0.05)],
                  0.04, ink, base, kind="NURBS")
        base.scale = (0, 0, 0)
        happy.append(base)

    # mouths: smile (the base one), grin, "o", flat
    mouth_base = oriented_empty("Orb_MouthBase", 0, -18, inset=0.02)
    grin = new_empty("Orb_Mouth_Grin", (0, 0, 0), mouth_base, size=0.05)
    sphere("Orb_Grin_Shape", 1.0, ink, grin, (0, 0, -0.02), (0.2, 0.05, 0.12), seg=32, rings=16)
    sphere("Orb_Grin_Tongue", 1.0, tongue, grin, (0, -0.035, -0.07), (0.1, 0.03, 0.05), seg=24, rings=12)
    oh = new_empty("Orb_Mouth_O", (0, 0, 0), mouth_base, size=0.05)
    sphere("Orb_O_Shape", 1.0, ink, oh, (0, 0, -0.02), (0.075, 0.05, 0.095), seg=24, rings=12)
    flat = new_empty("Orb_Mouth_Flat", (0, 0, 0), mouth_base, size=0.05)
    cylinder_between("Orb_Flat_Shape", (-0.11, -0.03, -0.02), (0.11, -0.03, -0.02), 0.035, ink, flat)
    mouths = {"smile": bpy.data.objects["Orb_Smile"], "grin": grin, "o": oh, "flat": flat}
    for k, m in mouths.items():
        m.scale = (1, 1, 1) if k == "smile" else (0, 0, 0)

    orb.update(brows=brows, happy=happy, mouths=mouths,
               blush_mat=bpy.data.materials["Orb_Blush"])


# --------------------------------------------------------------------------
# Choreography helpers
# --------------------------------------------------------------------------
class Choreo:
    BROWS = {  # (slant degrees for the left brow, raise)
        "neutral": (0, 0.0), "determined": (16, -0.02), "worried": (-18, 0.05),
        "happy": (-6, 0.06), "surprised": (0, 0.09), "sad": (-14, 0.0)}

    def __init__(self, orb):
        self.o = orb
        self.root, self.body = orb["root"], orb["body"]
        self.mouth_state = "smile"

    # --- transforms --------------------------------------------------------
    def at(self, f, x, z):
        kf_vec(self.root, "location", f, (x, 0, z))

    def face(self, f, deg):
        kf(self.root, "rotation_euler", f, math.radians(deg), index=2)

    def lean(self, f, deg):
        kf(self.body, "rotation_euler", f, math.radians(deg), index=1)

    def squash(self, f, sxy, sz):
        kf_vec(self.body, "scale", f, (sxy, sxy, sz))

    # --- expression --------------------------------------------------------
    def look(self, f, x, z):
        for p in self.o["pupils"]:
            kf_vec(p, "location", f, (x, -0.06, z))

    def eyes(self, f, kind="open"):
        sx, sz, happy = {"open": (1, 1, 0), "wide": (1.22, 1.25, 0), "squint": (1.05, 0.62, 0),
                         "closed": (1.08, 0.07, 0), "happy": (1, 0.0, 1)}[kind]
        for e in self.o["eyes"]:
            kf_vec(e, "scale", f, (sx, 1, sz))
        for h in self.o["happy"]:
            kf_vec(h, "scale", f, (happy, happy, happy))

    def blink(self, f, after="open"):
        self.eyes(f, after)
        self.eyes(f + 2, "closed")
        self.eyes(f + 5, after)

    def brows(self, f, kind="neutral"):
        slant, lift = self.BROWS[kind]
        for side, sgn in (("L", 1), ("R", -1)):
            b = self.o["brows"][side]
            kf(b, "rotation_euler", f, math.radians(slant * sgn), index=1)
            kf(b, "location", f, lift, index=2)

    def mouth(self, f, kind):
        if kind == self.mouth_state:
            return
        for k, m in self.o["mouths"].items():
            on = 1.0 if k == self.mouth_state else 0.0
            kf_vec(m, "scale", f - 1, (on, on, on))
            on = 1.0 if k == kind else 0.0
            kf_vec(m, "scale", f, (on, on, on))
        self.mouth_state = kind

    def expr(self, f, eyes=None, brows=None, mouth=None):
        if eyes:
            self.eyes(f, eyes)
        if brows:
            self.brows(f, brows)
        if mouth:
            self.mouth(f, mouth)

    def wobble(self, frames_angles):
        for f, a in frames_angles:
            kf(self.o["antenna"], "rotation_euler", f, math.radians(a), index=1)

    # --- the jump ------------------------------------------------------------
    def hop(self, f0, f1, p0, p1, height=0.8, crouch=5, feel=True, small=False):
        """A real jump: crouch, parabolic flight at constant horizontal speed, impact squash.
        p0/p1 are (x, z) of Orb's feet. f0 = take-off frame, f1 = landing frame."""
        x0, z0 = p0
        x1, z1 = p1
        if small:     # quick running hop
            self.squash(f0, 1.1, 0.9)
            self.squash((f0 + f1) // 2, 0.94, 1.08)
            self.squash(f1, 1.12, 0.88)
        else:
            self.squash(f0 - crouch, 1.0, 1.0)
            self.squash(f0 - 1, 1.2, 0.78)            # anticipation crouch
            self.squash(f0 + 2, 0.84, 1.22)           # stretch as he springs
            self.squash((f0 + f1) // 2, 1.0, 1.0)     # weightless at the apex
            self.squash(f1 - 1, 0.9, 1.12)            # stretch into the landing
            self.squash(f1 + 1, 1.28, 0.72)           # impact
            self.squash(f1 + 5, 0.94, 1.07)           # rebound
            self.squash(f1 + 9, 1.0, 1.0)
            self.at(f0 - crouch, x0, z0)
            self.wobble([(f0 - 1, -12), (f0 + 3, 22), (f1 + 1, -24), (f1 + 5, 14), (f1 + 9, -6), (f1 + 13, 0)])
        linear_keys(True)
        n = f1 - f0
        apex = max(z0, z1) + height
        # solve a parabola through (0,z0), (tp,apex), (1,z1) with the apex nearer the higher end
        a_ = math.sqrt(apex - z0)
        b_ = math.sqrt(apex - z1)
        tp = a_ / (a_ + b_)
        for i in range(n + 1):
            t = i / n
            if t <= tp:
                z = apex - (apex - z0) * ((tp - t) / tp) ** 2
            else:
                z = apex - (apex - z1) * ((t - tp) / (1 - tp)) ** 2
            self.at(f0 + i, x0 + (x1 - x0) * t, z)
        linear_keys(False)
        if feel and not small:
            # he feels it: gather himself, strain, brace, relief
            self.expr(f0 - crouch, eyes="squint", brows="determined", mouth="flat")
            self.expr(f0 + 2, eyes="wide", brows="surprised", mouth="o")
            self.expr(f1 - 2, eyes="squint", brows="worried")
            self.expr(f1 + 1, eyes="closed", mouth="flat")
            self.expr(f1 + 7, eyes="open", brows="happy", mouth="smile")


def sparkle_burst(name, centre, frame, parent, n=18):
    import random
    random.seed(11)
    mats = [emission(f"{name}_Amber", AMBER, 25.0), emission(f"{name}_White", "#FFFFFF", 18.0)]
    for i in range(n):
        a = 2 * math.pi * i / n + random.uniform(-0.15, 0.15)
        r = random.uniform(1.0, 2.2)
        end = centre + Vector((r * math.cos(a), random.uniform(-0.4, 0.2), r * math.sin(a)))
        s = sphere(f"{name}_{i:02d}", random.uniform(0.04, 0.08), mats[i % 2], parent, tuple(centre), seg=12, rings=6)
        kf_vec(s, "scale", 1, (0, 0, 0))
        kf_vec(s, "scale", frame - 1, (0, 0, 0))
        kf_vec(s, "location", frame, tuple(centre))
        kf_vec(s, "scale", frame, (1.4, 1.4, 1.4))
        kf_vec(s, "location", frame + 22, tuple(end))
        kf_vec(s, "scale", frame + 22, (0, 0, 0))


# --------------------------------------------------------------------------
# The film
# --------------------------------------------------------------------------
def animate_story(sc, orb, L, root):
    add_face_rig(orb)
    c = Choreo(orb)
    o = orb
    o["root"].scale = (ORB_SCALE,) * 3
    tip, tl = o["tip"], o["tip_light"]
    tl.energy = 25

    # ---- 1. IDLE: his antenna starts to twitch -------------------------------
    c.at(1, START_X, 0)
    c.face(1, 0)
    c.squash(1, 1, 1)
    c.lean(1, 0)
    c.look(1, 0, 0)
    c.expr(1, eyes="open", brows="neutral")
    c.blink(10)
    c.look(16, 0.08, 0.11)                         # glances up at it
    c.expr(18, brows="surprised")
    c.wobble([(1, 0), (19, 0), (22, 14), (24, -12), (26, 18), (28, -16), (30, 22)])

    # ---- 2. POP: the tip takes off and starts drawing the line --------------
    kf_vec(tip, "scale", 1, (1, 1, 1))
    kf_vec(tip, "scale", F_POP - 1, (1, 1, 1))
    kf_vec(tip, "scale", F_POP, (0, 0, 0))
    for f, e in ((1, 25), (F_POP - 1, 25), (F_POP, 0)):
        kf(tl, "energy", f, e)
    c.wobble([(F_POP, -30), (F_POP + 4, 20), (F_POP + 9, -10), (F_POP + 14, 0)])
    c.expr(F_POP + 1, eyes="wide", brows="surprised", mouth="o")
    c.look(F_POP + 3, 0.1, 0.12)
    c.hop(F_POP + 3, F_POP + 11, (START_X, 0), (START_X - 0.25, 0), height=0.3, crouch=2, feel=False)

    sc.frame_set(F_POP - 1)
    tip_pos = root.matrix_world.inverted() @ tip.matrix_world.translation

    spark = sphere("Spark", 0.11, emission("Spark_Glow", AMBER, 30.0), root, tuple(tip_pos), seg=24, rings=12)
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

    # The line chart. Every point is higher than the last: it only ever grows.
    above = 0.55
    path = [(F_POP, tip_pos),
            (F_POP + 14, Vector((-6.7, 0, 1.45))),
            (F_CHASE, Vector((-5.0, 0, 1.75))),
            (90, Vector((BAR_X[0], 0, BAR_TOP[0] + above))),
            (110, Vector((BAR_X[1], 0, BAR_TOP[1] + above))),
            (130, Vector((BAR_X[2], 0, BAR_TOP[2] + above))),
            (150, Vector(BREAK_A))]
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
    # then it draws the breakout line itself, slowly climbing out of reach
    bo = L["breakout"].data
    kf(bo, "bevel_factor_end", 1, 0.0)
    for f, fr in SPARK_FRAC:
        kf_vec(spark, "location", f, tuple(line_pt(fr) + Vector((0, 0, LINE_R))))
        kf(bo, "bevel_factor_end", f, fr)
    linear_keys(False)

    # bars grow out of the floor as the line passes over them
    for i, (bar, f_over) in enumerate(zip(L["bars"], (90, 110, 130, 150))):
        full = tuple(bar.scale)
        f0 = f_over - 8
        kf_vec(bar, "scale", 1, (0, 0, 0))
        kf_vec(bar, "scale", f0 - 1, (0, 0, 0))
        kf_vec(bar, "scale", f0, (full[0], full[1], 0.0))
        kf_vec(bar, "scale", f0 + 8, (full[0], full[1], full[2] * 1.12))
        kf_vec(bar, "scale", f0 + 13, (full[0], full[1], full[2] * 0.97))
        kf_vec(bar, "scale", f0 + 17, full)

    # ---- 3. CHASE: he runs after it --------------------------------------------
    c.face(F_CHASE - 6, 0)
    c.face(F_CHASE, 35)
    c.expr(F_CHASE - 4, eyes="squint", brows="determined", mouth="flat")
    c.look(F_CHASE, 0.09, 0.05)
    xs = [START_X - 0.25, -7.3, -6.3, -5.3, -4.3, -3.35]
    for i in range(len(xs) - 1):
        f0 = F_CHASE + 2 + i * 7
        c.hop(f0, f0 + 7, (xs[i], 0), (xs[i + 1], 0), height=0.22, small=True)
    c.at(F_CLIMB - 6, xs[-1], 0)

    # ---- 4. CLIMB: he feels every jump ----------------------------------------
    c.hop(F_CLIMB, F_CLIMB + 14, (xs[-1], 0), (BAR_X[0], BAR_TOP[0]), height=0.9)
    c.look(F_CLIMB + 16, 0.09, 0.1)
    c.hop(F_CLIMB + 22, F_CLIMB + 36, (BAR_X[0], BAR_TOP[0]), (BAR_X[1], BAR_TOP[1]), height=0.8)
    c.hop(F_CLIMB + 44, F_CLIMB + 58, (BAR_X[1], BAR_TOP[1]), (BAR_X[2], BAR_TOP[2]), height=0.8)
    c.expr(F_TEETER - 24, eyes="squint", brows="determined", mouth="flat")  # the big one, he psyches up
    c.look(F_TEETER - 24, 0.1, 0.08)

    # ---- 5. TEETER: the biggest step, he lands right on the edge ----------------
    edge_x = LX(206) + 0.1
    c.hop(F_TEETER - 16, F_TEETER, (BAR_X[2], BAR_TOP[2]), (edge_x, BAR_TOP[3]), height=1.0, feel=False)
    c.expr(F_TEETER - 14, eyes="wide", brows="surprised", mouth="o")
    c.expr(F_TEETER + 1, eyes="wide", brows="worried", mouth="o")
    c.look(F_TEETER + 2, -0.08, -0.1)              # looks down. long way down.
    for f, a in ((F_TEETER, 0), (F_TEETER + 3, -24), (F_TEETER + 7, 14), (F_TEETER + 11, -20),
                 (F_TEETER + 15, 10), (F_TEETER + 19, -12), (F_TEETER + 23, 0)):
        c.lean(f, a)
    c.wobble([(F_TEETER + 3, 30), (F_TEETER + 7, -26), (F_TEETER + 11, 24), (F_TEETER + 15, -14), (F_TEETER + 20, 0)])
    c.expr(F_TEETER + 23, eyes="closed", brows="happy", mouth="flat")   # phew
    c.squash(F_TEETER + 24, 1.12, 0.86)
    c.squash(F_TEETER + 30, 1.0, 1.0)
    c.at(F_TEETER + 30, edge_x, BAR_TOP[3])
    c.expr(F_TEETER + 30, eyes="open", mouth="smile")
    c.hop(F_TEETER + 32, F_TEETER + 38, (edge_x, BAR_TOP[3]), (BAR_X[3], BAR_TOP[3]), height=0.15, small=True)

    # ---- 6. EDGE: the spark keeps climbing, out of reach ------------------------
    c.look(F_EDGE, 0.1, 0.12)
    c.face(F_EDGE, 35)
    c.expr(F_EDGE + 4, eyes="open", brows="determined", mouth="flat")
    c.hop(F_EDGE + 10, F_EDGE + 26, (BAR_X[3], BAR_TOP[3]), (BAR_X[3], BAR_TOP[3]), height=1.1, crouch=6, feel=False)
    c.expr(F_EDGE + 12, eyes="wide", brows="determined", mouth="o")      # reaching...
    c.expr(F_EDGE + 27, eyes="squint", brows="sad", mouth="flat")       # ...not even close
    c.squash(F_EDGE + 30, 1.1, 0.88)                                    # slumps
    c.lean(F_EDGE + 30, 8)
    c.look(F_EDGE + 30, 0.0, -0.08)
    c.squash(F_FORESIGHT - 4, 1.1, 0.88)
    c.lean(F_FORESIGHT - 4, 8)

    # ---- 7. FORESIGHT: he stops chasing and looks ahead -------------------------
    b = o["body_mat"].node_tree.nodes["Principled BSDF"]
    set_input(b, ["Emission Color", "Emission"], hex_rgba(LOGO_WHITE))
    es, bc = b.inputs["Emission Strength"], b.inputs["Base Color"]
    slate = bc.default_value[:]
    for f, e in ((1, 0.0), (F_FORESIGHT, 0.0), (F_FORESIGHT + 18, 2.5), (F_LEAP, 2.0), (F_CATCH, 0.6)):
        kf_socket(es, f, e)
    c.squash(F_FORESIGHT + 6, 1.0, 1.0)
    c.lean(F_FORESIGHT + 6, 0)
    c.squash(F_FORESIGHT + 22, 1.05, 1.06)        # a slow breath in
    c.expr(F_FORESIGHT + 2, eyes="closed", brows="neutral", mouth="smile")
    c.look(F_FORESIGHT + 2, 0, 0)

    m_dash = emission("Forecast_Dash", AMBER, 7.0)
    dashes = []
    for i, fr in enumerate(DASH_FRACS):
        a, e = line_pt(fr - 0.03), line_pt(fr + 0.03)
        d = cylinder_between(f"Forecast_Dash_{i}", a, e, DASH_R, m_dash, root)
        f0 = F_FORESIGHT + 8 + i * 3
        kf_vec(d, "scale", 1, (0, 0, 0))
        kf_vec(d, "scale", f0, (0, 0, 0))
        kf_vec(d, "scale", f0 + 3, (1.4, 1.4, 1.4))
        kf_vec(d, "scale", f0 + 6, (1, 1, 1))
        fs = int(frame_for_frac(fr))           # the solid line catches up and replaces it
        kf_vec(d, "scale", fs - 1, (1, 1, 1))
        kf_vec(d, "scale", fs + 2, (0, 0, 0))
        dashes.append(d)
    c.expr(F_LEAP - 8, eyes="squint", brows="determined", mouth="grin")   # he sees it

    # ---- 8. OUTRUN THE LINE: hop along the forecast -------------------------------
    stand = lambda fr: (line_pt(fr).x, line_pt(fr).z + DASH_R)
    c.face(F_LEAP - 6, 30)
    c.hop(F_LEAP, F_LEAP + 14, (BAR_X[3], BAR_TOP[3]), stand(0.62), height=1.0, crouch=6)   # right over the spark
    c.hop(F_LEAP + 18, F_LEAP + 26, stand(0.62), stand(0.80), height=0.45, crouch=3)
    c.hop(F_LEAP + 30, F_LEAP + 38, stand(0.80), stand(0.98), height=0.45, crouch=3)
    end = stand(0.98)
    c.face(F_LEAP + 40, 30)
    c.face(F_LEAP + 44, -55)                       # turns round to wait for it
    c.expr(F_LEAP + 46, eyes="wide", brows="happy", mouth="grin")
    c.look(F_LEAP + 46, 0.1, -0.06)
    for k in range(3):                             # can't stand still
        f = F_LEAP + 44 + k * 2
        c.squash(f, 1.08, 0.92 if k % 2 else 1.06)
    c.squash(F_CATCH - 1, 1.0, 1.0)
    c.at(F_CATCH - 1, *end)

    # ---- 9. THE CATCH (and pure joy) ----------------------------------------------
    sc.frame_set(F_CATCH)
    tip_at_catch = root.matrix_world.inverted() @ tip.matrix_world.translation
    linear_keys(True)
    kf_vec(spark, "location", F_CATCH, tuple(tip_at_catch))
    kf(bo, "bevel_factor_end", F_CATCH, 1.0)
    linear_keys(False)
    kf_vec(spark, "scale", F_CATCH, (1, 1, 1))
    kf_vec(spark, "scale", F_CATCH + 1, (0, 0, 0))
    kf(sl, "energy", F_CATCH, 80)
    kf(sl, "energy", F_CATCH + 1, 0)
    kf_vec(tip, "scale", F_CATCH, (0, 0, 0))
    kf_vec(tip, "scale", F_CATCH + 1, (1.8, 1.8, 1.8))
    kf_vec(tip, "scale", F_CATCH + 8, (1, 1, 1))
    tip_strength = o["tip_mat"].node_tree.nodes["Emission"].inputs["Strength"]
    for f, e in ((1, 12), (F_CATCH, 12), (F_CATCH + 1, 80), (F_CATCH + 16, 12)):
        kf_socket(tip_strength, f, e)
    for f, e in ((F_CATCH, 0), (F_CATCH + 1, 600), (F_CATCH + 18, 25)):
        kf(tl, "energy", f, e)
    sparkle_burst("Joy_Sparkle", tip_at_catch, F_CATCH + 1, root)

    blush = o["blush_mat"].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"]
    for f, e in ((1, 0.4), (F_CATCH, 0.4), (F_CATCH + 3, 3.0), (F_CATCH + 40, 1.2)):
        kf_socket(blush, f, e)
    c.expr(F_CATCH + 1, eyes="happy", brows="happy", mouth="grin")
    c.squash(F_CATCH + 1, 1.3, 0.72)
    c.squash(F_CATCH + 5, 1.0, 1.0)
    c.face(F_CATCH + 3, -55)
    c.face(F_CATCH + 6, 0)
    # a spinning jump for joy, then a happy little bounce
    c.hop(F_CATCH + 10, F_CATCH + 26, end, end, height=0.9, crouch=3, feel=False)
    c.face(F_CATCH + 10, 0)
    c.face(F_CATCH + 26, 360)
    c.hop(F_CATCH + 30, F_CATCH + 40, end, end, height=0.4, crouch=3, feel=False)
    c.wobble([(F_CATCH + 2, 28), (F_CATCH + 6, -20), (F_CATCH + 10, 14), (F_CATCH + 27, -22), (F_CATCH + 32, 16), (F_CATCH + 40, -8), (F_CATCH + 46, 0)])
    c.expr(F_CATCH + 48, eyes="open", brows="happy", mouth="smile")
    c.look(F_CATCH + 48, 0, 0)
    c.blink(F_CATCH + 70)

    # the chase line has done its job: it retracts, leaving only the breakout line
    kf(trail.data, "bevel_factor_start", 1, 0.0)
    kf(trail.data, "bevel_factor_start", F_CATCH + 30, 0.0)
    kf(trail.data, "bevel_factor_start", F_REVEAL, 1.0)

    # ---- 10. THE REVEAL: the scene was the logo -------------------------------------
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
    kf(root, "location", F_REVEAL + 6, 0.0, index=2)
    kf(root, "location", F_REVEAL + 60, LOGO_LIFT, index=2)
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
    c.look(F_REVEAL + 10, -0.1, -0.1)              # he looks down at what he drew
    c.expr(F_REVEAL + 10, eyes="wide", brows="surprised", mouth="o")
    c.expr(F_REVEAL + 40, eyes="happy", brows="happy", mouth="grin")

    # ---- 11. MELT INTO THE MARK --------------------------------------------------------
    kf_socket(bc, F_MELT, slate)
    kf_socket(bc, F_MELT + 12, hex_rgba(LOGO_WHITE))
    kf_socket(es, F_MELT, 0.6)
    kf_socket(es, F_MELT + 12, 8.0)
    c.expr(F_MELT, eyes="happy", brows="happy", mouth="smile")
    for f, s_ in ((F_MELT, 1.0), (F_MELT + 10, 0.85), (F_MELT + 20, 0.4), (F_MELT + 26, 0.0)):
        s = ORB_SCALE * s_
        kf_vec(o["root"], "scale", f, (s, s, s))
        cx_ = DOT.x + (end[0] - DOT.x) * s_                      # body centre slides into the dot
        cz_ = DOT.z + (end[1] + ORB_CENTRE - DOT.z) * s_
        c.at(f, cx_, cz_ - ORB_CENTRE * s_)
    dot = L["dot"]
    for f, s_ in ((1, 0), (F_MELT + 14, 0), (F_MELT + 26, 1.25), (F_MELT + 32, 1.0)):
        kf_vec(dot, "scale", f, (s_, s_, s_))

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

    top = LZ(53) + LOGO_LIFT
    bottom = LZ(221) - (46 / 2.25) * S_LOGO - (MICHROMA_CAP / MICHROMA_UPM) * (40 / 2.25) * S_LOGO + LOGO_LIFT - (2.3 if TAGLINE else 0)
    centre_z = (top + bottom) / 2
    dist = ((top - bottom) / 0.62 / 2) / math.tan(math.atan(10.125 / 40))
    cx = LX(195.5)
    dz = DOT.z + LOGO_LIFT

    shots = [  # frame, camera, target
        (1, (START_X + 1.4, -6.5, 1.3), (START_X, 0, 0.6)),
        (F_POP - 4, (START_X + 1.0, -5.2, 1.1), (START_X, 0, 0.7)),
        (F_POP + 12, (START_X + 1.2, -6.2, 1.7), (-6.6, 0, 1.5)),       # follow the spark
        (F_CHASE - 2, (START_X + 1.4, -6.4, 1.5), (-6.2, 0, 1.0)),
        (F_CHASE + 22, (-5.6, -7.2, 1.6), (-5.2, 0, 1.0)),              # side-on tracking
        (F_CLIMB, (-3.6, -8.0, 2.0), (-3.0, 0, 1.4)),
        (F_CLIMB + 40, (-1.2, -8.2, 3.0), (-0.6, 0, 2.6)),              # crane up with the climb
        (F_TEETER - 12, (0.6, -7.0, 3.8), (1.0, 0, 3.6)),
        (F_TEETER + 4, (1.2, -4.8, 4.0), (1.4, 0, 3.9)),                # tight on the teeter
        (F_EDGE - 4, (1.6, -5.4, 4.3), (1.9, 0, 4.1)),
        (F_EDGE + 26, (2.6, -9.0, 4.8), (2.8, 0, 4.4)),
        (F_FORESIGHT, (3.0, -12.5, 5.2), (3.4, 0, 4.6)),                # wide: small Orb, line out of reach
        (F_LEAP - 6, (2.6, -8.0, 4.7), (2.9, 0, 4.6)),                  # push in on the glow
        (F_LEAP + 16, (3.8, -8.5, 5.3), (4.1, 0, 5.0)),                 # track the hops
        (F_LEAP + 40, (5.0, -7.2, 5.6), (5.2, 0, 5.3)),
        (F_CATCH, (5.2, -6.0, 5.7), (5.4, 0, 5.5)),                     # the catch, close
        (F_CATCH + 30, (5.3, -6.4, 5.8), (5.5, 0, 5.7)),
        (F_REVEAL, (5.0, -7.0, 5.8), (5.2, 0, 5.6)),
        (F_REVEAL + 30, (3.0, -24.0, 8.0), (2.0, 0, 6.0)),              # fast pull-back
        (F_REVEAL + 62, (cx, -dist * 0.95, centre_z), (cx, 0, centre_z)),
        (F_MELT, (cx, -dist * 0.9, centre_z), (cx, 0, centre_z)),
        (F_MELT + 10, (DOT.x - 0.5, -dist * 0.4, dz), (DOT.x - 0.5, 0, dz)),   # close on the melt
        (F_MELT + 28, (DOT.x - 1.0, -dist * 0.45, dz - 0.5), (DOT.x - 1.0, 0, dz - 0.5)),
        (F_TITLE + 10, (cx, -dist, centre_z), (cx, 0, centre_z)),       # end card
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
    if hasattr(sc.eevee, "volumetric_end"):
        sc.eevee.volumetric_end = 160.0
    build_world(sc)
    floor, grid_strength = build_stage()
    shaft = build_lights()

    root = new_empty("Story_Root", (0, 0, 0), size=1.5)     # everything that rises at the end
    orb = build_orb()
    orb["root"].parent = root
    L = build_logo_parts(root)
    animate_story(sc, orb, L, root)
    build_story_camera(sc)

    vol = sc.world.node_tree.nodes.get("Principled Volume")
    if vol:
        d = vol.inputs["Density"]
        kf_socket(d, 1, 0.018)
        kf_socket(d, F_REVEAL, 0.018)
        kf_socket(d, F_REVEAL + 40, 0.004)
    for f, v in ((1, 0.6), (F_CATCH, 0.6), (F_CATCH + 2, 3.0), (F_CATCH + 30, 0.8),
                 (F_REVEAL + 44, 2.5), (F_REVEAL + 70, 0.6), (FRAME_END, 0.5)):
        kf_socket(grid_strength.inputs[1], f, v)
    shaft.location = (1.5, 8.0, 26.0)
    for f, e in ((1, 6000), (F_REVEAL, 6000), (F_REVEAL + 50, 40000), (FRAME_END, 30000)):
        kf(shaft.data, "energy", f, e)

    setup_bloom(sc)
    sc.frame_set(1)
    print("Clairvoyant 'Orb chases the spark' scene built: %d frames. Space = preview, Ctrl+F12 = render." % FRAME_END)


main()
