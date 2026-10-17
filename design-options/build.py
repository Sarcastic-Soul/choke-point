# Builds three static mockups of the main screen. Same data, three different directions.
N = {
 "alice.moreno":(70,230,"user"),"Marketing-Contractors":(210,230,"group"),"Legacy-VPN-Users":(350,120,"group"),
 "IT-Support":(490,120,"group"),"JUMP-01":(630,70,"host"),"JUMP-03":(630,170,"host"),
 "adm-ivan":(770,110,"user"),"adm-kofi":(770,190,"user"),"Tier0-Admins":(880,150,"group"),
 "Domain Admins":(880,250,"group"),"DC01":(880,350,"crown"),
 "WEB-CMS-01":(350,320,"host"),"svc-deploy":(490,320,"user"),"Deploy-Admins":(630,320,"group"),"BUILD-01":(770,320,"host"),
}
MAIN=[("alice.moreno","Marketing-Contractors"),("Marketing-Contractors","Legacy-VPN-Users"),("Legacy-VPN-Users","IT-Support"),
 ("IT-Support","JUMP-01"),("IT-Support","JUMP-03"),("JUMP-01","adm-ivan"),("JUMP-03","adm-kofi"),("adm-ivan","Tier0-Admins"),
 ("adm-kofi","Tier0-Admins"),("Tier0-Admins","Domain Admins"),("Domain Admins","DC01")]
ALT=[("Marketing-Contractors","WEB-CMS-01"),("WEB-CMS-01","svc-deploy"),("svc-deploy","Deploy-Admins"),("Deploy-Admins","BUILD-01"),("BUILD-01","adm-kofi")]
CHOKE=("Legacy-VPN-Users","IT-Support")

def svg(st):
    o=[f'<svg viewBox="0 0 960 420" class="graph" role="img" aria-label="Attack paths from alice.moreno to DC01">']
    def line(a,b,cls):
        x1,y1,_=N[a];x2,y2,_=N[b]
        if st.get("ortho"):
            mx=(x1+x2)/2
            return f'<path d="M{x1},{y1} H{mx} V{y2} H{x2}" class="{cls}" fill="none"/>'
        return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" class="{cls}"/>'
    for a,b in ALT: o.append(line(a,b,"e alt"))
    for a,b in MAIN: o.append(line(a,b,"e choke" if (a,b)==CHOKE else "e main"))
    for n,(x,y,k) in N.items():
        c="n "+k
        r=st.get("r",7)
        if k=="crown": o.append(f'<circle cx="{x}" cy="{y}" r="{r+9}" class="ring"/>')
        shape=f'<rect x="{x-r}" y="{y-r}" width="{2*r}" height="{2*r}" class="{c}"/>' if st.get("square") else f'<circle cx="{x}" cy="{y}" r="{r}" class="{c}"/>'
        o.append(shape)
        anchor="start" if x<60 else ("end" if x>850 else "middle")
        dy=-16 if y<=230 else 26
        if n=="DC01": dy=34
        o.append(f'<text x="{x}" y="{y+dy}" text-anchor="{anchor}" class="lbl {"crownl" if k=="crown" else ""}">{n}</text>')
    cx=(N[CHOKE[0]][0]+N[CHOKE[1]][0])/2; cy=N[CHOKE[0]][1]
    o.append(f'<g class="cut"><line x1="{cx-10}" y1="{cy-12}" x2="{cx+10}" y2="{cy+12}"/><line x1="{cx+10}" y1="{cy-12}" x2="{cx-10}" y2="{cy+12}"/></g>')
    o.append('</svg>')
    return "\n".join(o)

TRANSCRIPT = """
<div class="msg you">alice.moreno's laptop was phished. What can the attacker reach?</div>
<div class="tool">attack_paths <span>alice.moreno</span></div>
<div class="tool">choke_points <span>alice.moreno</span></div>
<div class="tool">what_if_remove <span>Legacy-VPN-Users → IT-Support</span></div>
<div class="msg bot"><code>alice.moreno</code> has 33 paths to the crown jewels. The best single fix is the link from <code>Legacy-VPN-Users</code> to <code>IT-Support</code>. It sits on 30 of 33 paths. With it removed, paths drop from 33 to 3.</div>
<div class="ticket"><b>Draft fix</b><span>Remove Legacy-VPN-Users from IT-Support</span><code>Remove-ADGroupMember -Identity "IT-Support" -Members "Legacy-VPN-Users"</code><div class="btns"><button class="go">Approve fix</button><button>Dismiss</button></div></div>
"""

BASE_CSS = """
*{box-sizing:border-box;margin:0}
button{font:inherit;cursor:pointer}
.graph{width:100%;height:auto;display:block}
.lbl{font-size:12px}
code{font-family:var(--mono);font-size:.92em}
"""

def page(title, fonts, css, body):
    return f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="{fonts}" rel="stylesheet"><style>{BASE_CSS}{css}</style></head><body>{body}</body></html>'

# ---------- Option 1: Signal box (paper, ink, one vermilion) ----------
css1 = """
:root{--paper:#F2EDE2;--ink:#1E1B16;--mute:#7A7365;--rule:#CFC7B4;--hot:#D2391C;--serif:'Fraunces',serif;--mono:'IBM Plex Mono',monospace;--sans:'Manrope',sans-serif}
body{background:var(--paper);color:var(--ink);font-family:var(--sans);min-height:100vh;padding:28px 40px}
header{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid var(--ink);padding-bottom:10px}
header h1{font:600 22px var(--serif);letter-spacing:-.01em}header small{font:12px var(--mono);color:var(--mute)}
.wrap{display:grid;grid-template-columns:1fr 360px;gap:40px;margin-top:22px}
.big{display:flex;align-items:baseline;gap:18px}
.big .a{font:300 150px/0.9 var(--serif);letter-spacing:-.04em;color:var(--mute);text-decoration:line-through;text-decoration-thickness:4px}
.big .b{font:600 190px/0.9 var(--serif);letter-spacing:-.05em;color:var(--hot)}
.big p{font:13px var(--mono);max-width:150px;color:var(--mute);align-self:flex-end;padding-bottom:18px}
.stage{border-top:1px solid var(--rule);margin-top:6px;padding-top:10px}
.e{stroke-width:1.5;fill:none}.e.main{stroke:var(--hot);stroke-width:3}.e.alt{stroke:var(--mute);stroke-dasharray:4 5}.e.choke{stroke:var(--hot);stroke-width:5}
.n{fill:var(--paper);stroke:var(--ink);stroke-width:2}.n.user{fill:var(--ink)}.n.crown{fill:var(--hot);stroke:var(--hot)}.ring{fill:none;stroke:var(--hot);stroke-width:1.5}
.lbl{font-family:var(--mono);fill:var(--ink)}.crownl{fill:var(--hot);font-weight:600}
.cut line{stroke:var(--ink);stroke-width:3}
aside{border-left:1px solid var(--ink);padding-left:28px;display:flex;flex-direction:column;gap:14px;font-size:14px;line-height:1.5}
.msg.you{font:italic 400 18px/1.35 var(--serif)}.msg.bot code{background:#E7DFCD;padding:1px 4px}
.tool{font:12px var(--mono);color:var(--mute);border-left:3px solid var(--rule);padding-left:10px}.tool span{color:var(--ink)}
.ticket{border:2px solid var(--ink);padding:14px;display:flex;flex-direction:column;gap:8px}.ticket span{font-weight:600}.ticket code{font-size:11px;background:#E7DFCD;padding:6px;overflow-wrap:anywhere}
.btns{display:flex;gap:8px}.btns button{padding:8px 14px;border:2px solid var(--ink);background:none;font:600 13px var(--sans)}.btns .go{background:var(--hot);border-color:var(--hot);color:var(--paper)}
.ask{margin-top:auto;border-top:2px solid var(--ink);padding-top:10px;font:13px var(--mono);color:var(--mute)}
"""
b1 = f"""<header><h1>Choke Point</h1><small>NORTHWIND FREIGHT · 671 nodes · 1,160 edges · scan 17 Oct</small></header>
<div class="wrap"><main><div class="big"><span class="a">33</span><span class="b">3</span><p>attack paths to the domain controller, before and after one cut</p></div>
<div class="stage">{svg({"ortho":True,"square":True,"r":6})}</div></main>
<aside>{TRANSCRIPT}<div class="ask">Ask about an identity…</div></aside></div>"""
open("option-1.html","w").write(page("Option 1 - Signal box","https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,600&family=IBM+Plex+Mono:wght@400;600&family=Manrope:wght@400;600&display=swap",css1,b1))

# ---------- Option 2: Night shift (warm dark, one signal orange, full-bleed canvas) ----------
css2 = """
:root{--bg:#15120F;--panel:#1D1915;--bone:#ECE4D4;--mute:#8C8372;--line:#3A342B;--hot:#FF5B2E;--disp:'Newsreader',serif;--sans:'IBM Plex Sans',sans-serif;--mono:'IBM Plex Mono',monospace}
body{background:var(--bg);color:var(--bone);font-family:var(--sans);min-height:100vh;position:relative;overflow:hidden}
.canvas{position:absolute;inset:0;padding:120px 80px 90px 440px}
.grid{position:absolute;inset:0;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:48px 48px;opacity:.35}
.dock{position:absolute;left:28px;top:28px;bottom:28px;width:380px;background:var(--panel);border:1px solid var(--line);padding:22px;display:flex;flex-direction:column;gap:14px;font-size:14px;line-height:1.5;overflow:hidden}
.dock h1{font:500 26px var(--disp);letter-spacing:-.01em}.dock h1 i{color:var(--hot)}
.hud{position:absolute;right:44px;top:34px;text-align:right}.hud .row{display:flex;gap:26px;justify-content:flex-end;align-items:baseline}
.hud b{font:400 96px/1 var(--disp);letter-spacing:-.03em}.hud b.hot{color:var(--hot)}.hud small{display:block;font:11px var(--mono);color:var(--mute);letter-spacing:.08em;text-transform:uppercase}
.e{fill:none;stroke-width:1.5}.e.main{stroke:var(--hot);stroke-width:2.5}.e.alt{stroke:var(--mute);stroke-dasharray:3 6}.e.choke{stroke:var(--hot);stroke-width:5}
.n{fill:var(--bg);stroke:var(--bone);stroke-width:1.5}.n.user{fill:var(--bone)}.n.crown{fill:var(--hot);stroke:var(--hot)}.ring{fill:none;stroke:var(--hot);stroke-width:1;opacity:.6}
.lbl{font-family:var(--mono);fill:var(--bone);font-size:11px}.crownl{fill:var(--hot)}.cut line{stroke:var(--bone);stroke-width:3}
.msg.you{color:var(--mute)}.msg.bot code{color:var(--hot)}
.tool{font:11px var(--mono);color:var(--mute)}.tool span{color:var(--bone)}.tool::before{content:'▸ ';color:var(--hot)}
.ticket{background:var(--bg);border:1px solid var(--line);padding:14px;display:flex;flex-direction:column;gap:8px}.ticket b{font:11px var(--mono);color:var(--hot);letter-spacing:.08em;text-transform:uppercase}.ticket code{font-size:11px;color:var(--mute);overflow-wrap:anywhere}
.btns{display:flex;gap:8px}.btns button{padding:8px 14px;border:1px solid var(--line);background:none;color:var(--bone);font:500 13px var(--sans)}.btns .go{background:var(--hot);border-color:var(--hot);color:#15120F;font-weight:600}
"""
b2 = f"""<div class="grid"></div><div class="canvas">{svg({"r":7})}</div>
<div class="hud"><div class="row"><div><small>Before</small><b>33</b></div><div><small>After one cut</small><b class="hot">3</b></div></div></div>
<div class="dock"><h1>Choke <i>Point</i></h1>{TRANSCRIPT}</div>"""
open("option-2.html","w").write(page("Option 2 - Night shift","https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400&display=swap",css2,b2))

# ---------- Option 3: Poster (Swiss grid, black blocks, one acid lime) ----------
css3 = """
:root{--bg:#ECEAE3;--ink:#0E0E0C;--lime:#C6F01B;--mute:#6C6B63;--disp:'Space Grotesk',sans-serif;--mono:'JetBrains Mono',monospace;--sans:'Space Grotesk',sans-serif}
body{background:var(--bg);color:var(--ink);font-family:var(--sans);min-height:100vh;display:grid;grid-template-columns:420px 1fr;grid-template-rows:auto 1fr}
.side{grid-row:1/3;background:var(--ink);color:var(--bg);padding:26px;display:flex;flex-direction:column;gap:14px;font-size:14px;line-height:1.5}
.side h1{font:700 15px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--lime)}
.numeral{font:700 330px/0.78 var(--disp);letter-spacing:-.08em;margin:18px 0 0 -10px;color:var(--bg)}.numeral em{font-style:normal;color:var(--lime)}
.cap{font:12px var(--mono);color:#A8A79C;text-transform:uppercase;letter-spacing:.06em}
.top{display:flex;justify-content:space-between;padding:20px 32px;border-bottom:3px solid var(--ink);font:600 12px var(--mono);text-transform:uppercase;letter-spacing:.08em}
.stage{padding:20px 32px;position:relative}
.stage .idx{position:absolute;left:32px;top:14px;font:600 12px var(--mono)}
.e{fill:none;stroke-width:2}.e.main{stroke:var(--ink);stroke-width:4}.e.alt{stroke:var(--mute);stroke-dasharray:2 6}.e.choke{stroke:var(--lime);stroke-width:9}
.n{fill:var(--bg);stroke:var(--ink);stroke-width:3}.n.user{fill:var(--ink)}.n.crown{fill:var(--ink);stroke:var(--ink)}.ring{fill:var(--lime);stroke:var(--ink);stroke-width:3}
.lbl{font-family:var(--mono);fill:var(--ink);font-weight:600;font-size:11.5px}.cut line{stroke:var(--ink);stroke-width:4}
.msg.you{color:#A8A79C}.msg.bot code{background:var(--lime);color:var(--ink);padding:0 4px}
.tool{font:11px var(--mono);color:#A8A79C}.tool span{color:var(--bg)}
.ticket{border:2px solid var(--lime);padding:14px;display:flex;flex-direction:column;gap:8px}.ticket b{font:11px var(--mono);color:var(--lime);letter-spacing:.1em;text-transform:uppercase}.ticket code{font-size:11px;color:#A8A79C;overflow-wrap:anywhere}
.btns{display:flex;gap:8px}.btns button{padding:9px 14px;border:2px solid var(--bg);background:none;color:var(--bg);font:600 13px var(--sans)}.btns .go{background:var(--lime);border-color:var(--lime);color:var(--ink)}
"""
b3 = f"""<aside class="side"><h1>Choke Point</h1><div class="numeral">33<em>→3</em></div><div class="cap">attack paths to the domain controller, before and after one cut</div>{TRANSCRIPT}</aside>
<div class="top"><span>Northwind Freight</span><span>alice.moreno → DC01</span><span>Scan 17 Oct</span></div>
<main class="stage"><span class="idx">FIG. 1 — ROUTES FROM A PHISHED CONTRACTOR</span><div style="height:20px"></div>{svg({"r":8,"square":True})}</main>"""
open("option-3.html","w").write(page("Option 3 - Poster","https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;600&display=swap",css3,b3))
print("ok")
