"""One-off: turn roof outlines traced on the gridded zoom crops (pixel coords of crops of site/data/campus.jpg; crop origins and scales are in zoom_params.json)
into tools/campus_overrides.json (lon/lat rings + heights)."""
import json, math
S,W,N,E=22.8085,86.1855,22.8210,86.1960; IW,IH=1957,2528
P=json.load(open('tools/zoom_params.json'))
T=[ # crop, label or None, height m, outline px
('A',None,19,[(160,245),(300,250),(420,330),(465,340),(475,640),(500,680),(500,1180),(480,1250),(240,1265),(205,1200),(180,700),(160,400)]),
('B','Learning Center 2',16,[(545,225),(800,285),(790,420),(985,485),(940,760),(880,775),(860,900),(700,935),(440,915),(430,800),(330,810),(320,700),(290,640),(320,345),(520,345)]),
('B',None,9,[(305,1040),(470,1035),(480,1150),(310,1160)]),
('B',None,9,[(500,1065),(700,1065),(700,1180),(505,1190)]),
('C','International Center',34,[(410,285),(500,275),(495,330),(450,870),(360,895),(280,850),(270,765),(305,740),(305,620),(345,600),(350,480),(395,470)]),
('C',None,8,[(245,205),(395,215),(400,300),(260,315)]),
('C','Fr. Tome',7,[(300,935),(405,930),(410,1130),(285,1130)]),
('C',None,4,[(425,905),(465,905),(465,975),(425,975)]),
('D','D-Block',12.5,[(310,170),(480,180),(500,345),(325,355)]),
('D','C-Block',12.5,[(330,385),(510,395),(545,585),(350,590)]),
('D','B-Block',12.5,[(360,600),(540,600),(570,790),(380,795)]),
('D','A-Block',12.5,[(385,810),(560,820),(590,1010),(415,1035)]),
('E',None,6,[(225,172),(300,176),(330,500),(388,905),(305,930),(250,500)]),
('E',None,12,[(425,490),(650,490),(665,680),(440,690)]),
('E',None,12,[(430,725),(655,725),(680,915),(445,920)]),
('E',None,12,[(450,965),(650,960),(680,1140),(460,1140)]),
('F','Learning Center 1',12,[(215,180),(300,176),(310,480),(400,490),(402,580),(240,590)]),
('F',None,12,[(300,170),(505,158),(510,250),(350,252),(350,235),(302,235)]),
('F',None,12,[(470,278),(550,278),(555,358),(475,358)]),
('F',None,11,[(415,250),(470,250),(475,360),(500,362),(500,430),(455,432),(455,372),(415,372)]),
('F',None,12,[(400,430),(560,425),(572,520),(405,530)]),
('F',None,8,[(305,340),(415,340),(415,390),(308,390)]),
('F','Admin Building',11,[(735,220),(950,198),(955,165),(1015,165),(1020,200),(1130,195),(1135,265),(1030,275),(1025,330),(1040,385),(910,400),(905,335),(765,352)]),
('G',None,10.5,[(130,275),(320,265),(322,318),(133,325)]),
('G',None,10.5,[(148,430),(333,425),(335,470),(150,480)]),
('G',None,10.5,[(133,325),(195,322),(200,432),(148,432)]),
('G',None,10.5,[(280,318),(322,318),(333,425),(285,428)]),
('G','Sports Block',10,[(338,250),(400,248),(412,320),(450,330),(452,470),(360,480),(345,330)]),
('G',None,10.5,[(455,375),(600,362),(605,440),(462,450)]),
('G',None,10.5,[(610,300),(680,295),(690,270),(800,280),(805,350),(770,360),(770,420),(710,425),(705,385),(615,390)]),
('G',None,10.5,[(860,300),(1085,287),(1088,350),(900,385),(865,380)]),
('G',None,4,[(910,385),(1035,378),(1038,410),(912,415)]),
('G',None,10.5,[(1100,95),(1180,90),(1195,225),(1200,230),(1210,330),(1095,340),(1090,265),(1120,260),(1115,225)]),
('G',None,4,[(460,250),(530,245),(535,315),(465,320)]),
('H','Jehangir Gandhy Library',10,[(400,200),(665,170),(692,300),(410,318)]),
('H',None,6,[(215,195),(390,180),(395,320),(225,335)]),
('H','TATA Auditorium',14,[(505,800),(690,790),(715,1060),(530,1075)]),
('H',None,9,[(500,1050),(755,1020),(770,1080),(745,1130),(545,1155),(505,1100)]),
('H',None,6,[(700,810),(740,800),(770,1010),(712,1015)]),
('H',None,5,[(565,738),(712,728),(716,764),(568,774)]),
]
# campus names from people who live there; Google Maps confirms Bishu Da's position
LABELS=[ # (crop, x, y) or ('ll', lat, lon); name; label height m; description
 ('G',235,375,'STR (St Thomas Hostel)',11,'Part of the Old Hostel complex.'),
 ('G',530,405,'MTR Hostel',11,'Part of the Old Hostel complex.'),
 ('G',705,350,'Nilima Hostel',11,'Part of the Old Hostel complex.'),
 ('G',1150,250,'Fr. Enright Hostel',11,'The biggest hostel on campus, right by the main gate.'),
 ('A',330,520,'NH Boys Hostel',19,'New Hostel, boys’ side.'),
 ('A',350,1000,'NH Girls Hostel',19,'New Hostel, girls’ side, next to LC2.'),
 ('H',885,330,'MDP Hostel',7,'Rooms for people visiting from outside for management development programmes.'),
 ('H',360,870,'Bishu Da',5,'One of the oldest stalls on campus. Home of the legendary Pindi paratha, veg and non-veg.'),
 ('H',360,870,'Jampot',8.5,'Student-run café: momos, pasta and good coffee.'),
 ('H',640,751,"Aiyer's Café",5,'South Indian food.'),
 ('ll',22.81732,86.19138,'Jaima',5,''),
 ('E',550,815,"Teachers' Residence",12,'Faculty housing, across from Diamond Jubilee Park.'),
 ('G',975,200,'JLT',0,'The lawn inside the L of Fr. Enright Hostel, where the parties happen.'),
 ('ll',22.8123,86.19155,'Football Ground',0,'The big football ground beside the turf.'),
]
GATES=[ # snapped onto the nearest road when baking
 ('ll',22.8128,86.1906,'Main Gate','Main entrance to campus, with the security check.'),
 ('ll',22.81913,86.19071,'Exit Gate','Campus exit onto Marine Drive.'),
]
RENAME={'Aziz Juice Store':'Aziz Juice Center','TATA Auditorium':'Tata Auditorium','Security Check':None}
DESC={'Tata Auditorium':'Home of placements: the placement process runs from here.',
      'Jehangir Gandhy Library':'The campus library.','Learning Center 1':'Classrooms (LC1).','Learning Center 2':'Classrooms (LC2).'}

def ll(crop,x,y):
    if crop=='ll': return [round(y,6),round(x,6)]
    p=P[crop]; X=p['x0']+x/p['Z']; Y=p['y0']+y/p['Z']
    return [round(W+X/IW*(E-W),6), round(N-Y/IH*(N-S),6)]

out=[]
for crop,name,h,px in T:
    p=P[crop]
    ring=[]
    for x,y in px:
        X=p['x0']+x/p['Z']; Y=p['y0']+y/p['Z']
        ring.append([round(W+X/IW*(E-W),6), round(N-Y/IH*(N-S),6)])
    out.append({"name":name,"height":h,"ring":ring})
doc={"_note":"Hand-traced XLRI campus roof outlines (from the satellite image) with estimated heights. Each entry replaces whatever map footprint sits under it. 'name' puts a label on that part.",
     "replace_names":["Hostel 2nd Year","Learning Center 2","International Center","Fr. Tome","A-Block","B-Block","C-Block","D-Block","Learning Center 1","Admin Building","Hostel 1st Year","TATA Auditorium","Jehangir Gandhy Library"],
     "buildings":out,
     "labels":[{"name":n,"lonlat":ll(c,x,y),"h":h,"desc":d} for c,x,y,n,h,d in LABELS],
     "gates":[{"name":n,"lonlat":ll(c,x,y),"desc":d} for c,x,y,n,d in GATES],
     "rename":RENAME,"desc":DESC,
     # no trees are placed inside these rings (the football ground's grass reads as canopy otherwise)
     "no_trees":[[[round(86.19155+0.00070*math.cos(t*math.pi/18),6),round(22.8123+0.00056*math.sin(t*math.pi/18),6)] for t in range(36)]]}
json.dump(doc,open('tools/campus_overrides.json','w'),indent=1)
print(len(out))
