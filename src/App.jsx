import React, { useState, useEffect, useRef, useCallback } from "react";
import { storage, isSupabaseConfigured } from "./storage.js";

// ─── Inject external deps ────────────────────────────────────────────────────
function useExternalCSS(href){
  useEffect(()=>{
    if(document.querySelector(`link[href="${href}"]`)) return;
    const link=document.createElement("link");
    link.rel="stylesheet";link.href=href;
    document.head.appendChild(link);
  },[href]);
}

// ─── Utility ────────────────────────────────────────────────────────────────
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,8);
const fmtDate = (d) => {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
};
const SHOW_COLORS = ["#E51A2C","#0066FF","#FFD700","#00C853","#9C27B0","#FF6D00","#00BCD4","#E91E63"];
const DEFAULT_MATCH_TYPES = [
  {id:"singles",name:"Singles",participants:2,isTag:false,isDefault:true},
  {id:"tag",name:"Tag Team",participants:2,isTag:true,isDefault:true},
  {id:"triple_threat",name:"Triple Threat",participants:3,isTag:false,isDefault:true},
  {id:"fatal_4way",name:"Fatal 4-Way",participants:4,isTag:false,isDefault:true},
  {id:"tag_triple_threat",name:"Tag Triple Threat",participants:3,isTag:true,isDefault:true},
  {id:"tag_fatal_4way",name:"Tag Fatal 4-Way",participants:4,isTag:true,isDefault:true},
  {id:"elimination_tag",name:"Elimination Tag",participants:2,isTag:true,isDefault:true},
];
const INIT_STATE = {
  wrestlers:[],shows:[],tagTeams:[],championships:[],matches:[],
  matchTypes:DEFAULT_MATCH_TYPES.map(t=>({...t})),
  editPassword:""
};

// ─── Data migration / sanitization ───────────────────────────────────────────
// Called whenever loading a save (cloud or file). Fills in missing fields with
// safe defaults so old saves don't crash components that now expect new fields.
function sanitizeLoadedData(d){
  if(!d||typeof d!=="object")return{...INIT_STATE};
  const safeArr=(v)=>Array.isArray(v)?v:[];
  const safeStr=(v)=>typeof v==="string"?v:"";
  const safeNum=(v)=>(typeof v==="number"&&!isNaN(v))?v:0;
  const safeBool=(v)=>typeof v==="boolean"?v:false;
  return {
    wrestlers: safeArr(d.wrestlers).map(w=>({
      id:w.id||uid(),name:safeStr(w.name)||"Unknown",
      nickname:safeStr(w.nickname),showId:safeStr(w.showId),
      image:safeStr(w.image),createdAt:safeStr(w.createdAt),
    })),
    shows: safeArr(d.shows).map(s=>({
      id:s.id||uid(),name:safeStr(s.name)||"Unknown Show",
      showType:safeStr(s.showType)||"weekly",color:safeStr(s.color)||"#E51A2C",
      day:safeStr(s.day),description:safeStr(s.description),
      image:safeStr(s.image),pleDate:safeStr(s.pleDate),venue:safeStr(s.venue),
      linkedShows:safeArr(s.linkedShows),
    })),
    tagTeams: safeArr(d.tagTeams).map(t=>{
      const memberIds=safeArr(t.memberIds).length>0
        ?safeArr(t.memberIds)
        :[t.member1Id,t.member2Id].filter(x=>typeof x==="string"&&x);
      return{
        id:t.id||uid(),name:safeStr(t.name)||"Unknown Team",
        member1Id:safeStr(t.member1Id),member2Id:safeStr(t.member2Id),memberIds,
      };
    }),
    championships: safeArr(d.championships).map(c=>({
      id:c.id||uid(),name:safeStr(c.name)||"Unknown Championship",
      type:safeStr(c.type)||"singles",showId:safeStr(c.showId),
      image:safeStr(c.image),defenses:safeNum(c.defenses),
      wonDate:c.wonDate||null,currentHolderId:c.currentHolderId||null,
      history:safeArr(c.history).map(h=>({
        holderId:safeStr(h.holderId),wonDate:safeStr(h.wonDate),
        lostDate:h.lostDate||null,defenses:safeNum(h.defenses),
        cashedIn:safeBool(h.cashedIn),vacated:safeBool(h.vacated),
      })),
    })),
    matches: safeArr(d.matches).map(m=>({
      id:m.id||uid(),
      date:safeStr(m.date)||new Date().toISOString().slice(0,10),
      showId:safeStr(m.showId),matchType:safeStr(m.matchType)||"singles",
      notes:safeStr(m.notes),
      wrestlers:safeArr(m.wrestlers),
      winnerIds:safeArr(m.winnerIds),
      tagTeamIds:m.tagTeamIds?safeArr(m.tagTeamIds):null,
      adhocTeams:m.adhocTeams?safeArr(m.adhocTeams).map(at=>({
        id:safeStr(at.id),label:safeStr(at.label),memberIds:safeArr(at.memberIds),
      })):null,
      winnerTagTeamId:m.winnerTagTeamId||null,
      winnerAdhocId:m.winnerAdhocId||null,
      slotActiveMembers:(m.slotActiveMembers&&typeof m.slotActiveMembers==="object")?m.slotActiveMembers:null,
      isChampionshipMatch:safeBool(m.isChampionshipMatch),
      championshipId:safeStr(m.championshipId),
      championshipIds:safeArr(m.championshipIds).length>0
        ?safeArr(m.championshipIds)
        :(m.championshipId?[m.championshipId]:[]),
      titleChanged:safeBool(m.titleChanged),
      titleChangedFrom:safeStr(m.titleChangedFrom),
      titleChangedTo:safeStr(m.titleChangedTo),
    })),
    matchTypes: safeArr(d.matchTypes).length>0
      ?safeArr(d.matchTypes).map(t=>({
          id:safeStr(t.id)||uid(),name:safeStr(t.name)||"Match",
          participants:safeNum(t.participants)||2,
          isTag:safeBool(t.isTag),isDefault:safeBool(t.isDefault),
        }))
      :DEFAULT_MATCH_TYPES.map(t=>({...t})),
    editPassword:safeStr(d.editPassword),
  };
}

// ─── Hooks ──────────────────────────────────────────────────────────────────
function useToasts() {
  const [toasts,setToasts] = useState([]);
  const add = useCallback((msg,type="info")=>{
    const id=uid();
    setToasts(p=>[...p,{id,msg,type}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),2600);
  },[]);
  return [toasts,add];
}

// ─── Stat helpers ────────────────────────────────────────────────────────────
// Safe array getter — always returns an array even if field is null/undefined
const sa=(v)=>Array.isArray(v)?v:[];

function getRecord(wrestlerId, matches) {
  let wins=0,losses=0;
  sa(matches).forEach(m=>{
    const ws=sa(m.wrestlers);const wi=sa(m.winnerIds);
    if(ws.includes(wrestlerId)){
      if(wi.includes(wrestlerId)) wins++; else losses++;
    }
  });
  return {wins,losses,total:wins+losses,pct:(wins+losses)>0?wins/(wins+losses):0};
}
function getTagRecord(teamId,matches){
  let wins=0,losses=0;
  sa(matches).forEach(m=>{
    if(sa(m.tagTeamIds).includes(teamId)){
      if(m.winnerTagTeamId===teamId) wins++; else losses++;
    }
  });
  return {wins,losses,total:wins+losses,pct:(wins+losses)>0?wins/(wins+losses):0};
}
function getRecentForm(wid,matches,count){
  const rel=sa(matches).filter(m=>sa(m.wrestlers).includes(wid))
    .sort((a,b)=>{const d=new Date(b.date)-new Date(a.date);return d!==0?d:matches.indexOf(b)-matches.indexOf(a);}).slice(0,count);
  if(!rel.length)return 0;
  return rel.filter(m=>sa(m.winnerIds).includes(wid)).length/rel.length;
}
function getCurrentChampionships(wid,championships){
  return sa(championships).filter(c=>c.type==="singles"&&c.currentHolderId===wid);
}
function getPowerRating(wid,state){
  const rec=getRecord(wid,sa(state.matches));
  const recent=getRecentForm(wid,sa(state.matches),5);
  const champs=getCurrentChampionships(wid,sa(state.championships));
  let defenses=0;
  sa(state.championships).forEach(c=>{if(c.type==="singles"&&c.currentHolderId===wid)defenses+=c.defenses;});
  return Math.min(Math.round(rec.pct*45+recent*20+(champs.length?18:0)+Math.min(defenses*3,12)+Math.min(rec.total*0.4,5)),100);
}
function getStreak(wid,matches){
  const rel=sa(matches).filter(m=>sa(m.wrestlers).includes(wid)).sort((a,b)=>{const d=new Date(b.date)-new Date(a.date);return d!==0?d:matches.indexOf(b)-matches.indexOf(a);});
  if(!rel.length)return 0;
  const firstIsWin=sa(rel[0].winnerIds).includes(wid);
  let streak=0;
  for(const m of rel){
    if(sa(m.winnerIds).includes(wid)===firstIsWin)streak++;
    else break;
  }
  return firstIsWin?streak:-streak;
}

// ─── Image input helper ──────────────────────────────────────────────────────
function ImageInput({value,onChange,placeholder="fa-image",circle=false,label="Image"}){
  const fileRef=useRef();
  const handleFile=(e)=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      const img=new Image();
      img.onload=()=>{
        const max=256;let w=img.width,h=img.height;
        if(w>max||h>max){if(w>h){h=Math.round(h*max/w);w=max;}else{w=Math.round(w*max/h);h=max;}}
        const cv=document.createElement("canvas");cv.width=w;cv.height=h;
        cv.getContext("2d").drawImage(img,0,0,w,h);
        onChange(cv.toDataURL("image/jpeg",0.8));
      };
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
    e.target.value="";
  };
  const rad=circle?"50%":"8px";
  return(
    <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
      <div style={{width:72,height:72,borderRadius:rad,border:"2px dashed var(--border)",background:"var(--bg-input)",display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0}}>
        {value?<img src={value} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<i className={`fas ${placeholder}`} style={{color:"var(--text-muted)",fontSize:24}}/>}
      </div>
      <div style={{flex:1,display:"flex",flexDirection:"column",gap:6}}>
        <input className="form-input" value={value||""} onChange={e=>onChange(e.target.value)} placeholder="Paste image URL..."/>
        <div style={{display:"flex",gap:6}}>
          <button type="button" className="btn btn-secondary btn-sm" onClick={()=>fileRef.current.click()}><i className="fas fa-upload"/> Upload</button>
          {value&&<button type="button" className="btn btn-secondary btn-sm" onClick={()=>onChange("")}><i className="fas fa-times"/> Clear</button>}
        </div>
        <input type="file" ref={fileRef} accept="image/*" style={{display:"none"}} onChange={handleFile}/>
      </div>
    </div>
  );
}

// ─── Chip Selector ───────────────────────────────────────────────────────────
function ChipSelector({items,selected,onToggle,max,labelKey="name",winnerMode=false,selectedWinners=[],onWinnerToggle,renderLabel,disabledIds=[]}){
  const [search,setSearch]=useState("");
  const filtered=items.filter(i=>{
    if(selected.includes(i.id))return true;
    if(!search)return true;
    return (i[labelKey]||"").toLowerCase().includes(search.toLowerCase());
  });
  return(
    <div>
      {items.length>6&&<input className="form-input" style={{marginBottom:8,fontSize:14,padding:"8px 12px"}} placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}/>}
      <div style={{display:"flex",flexWrap:"wrap",gap:6,maxHeight:180,overflowY:"auto"}}>
        {filtered.map(i=>{
          const sel=selected.includes(i.id);
          const fullUp=!sel&&selected.length>=(max||99);
          const clashes=!sel&&disabledIds.includes(i.id);
          const disabled=fullUp||clashes;
          return(
            <div key={i.id} className={`chip${sel?" selected":""}`}
              title={clashes?"Shares a member with a group already selected":undefined}
              style={{opacity:disabled?0.4:1,cursor:disabled?"not-allowed":"pointer",pointerEvents:disabled?"none":"auto",
                outline:clashes?"1px dashed var(--error)":"none"}}
              onClick={()=>onToggle(i.id)}>{renderLabel?renderLabel(i):i[labelKey]}{clashes&&<i className="fas fa-triangle-exclamation" style={{marginLeft:5,color:"var(--error)",fontSize:10}}/>}</div>
          );
        })}
        {filtered.length===0&&<span style={{color:"var(--text-muted)",fontStyle:"italic",fontSize:13}}>No results</span>}
      </div>
      {winnerMode&&selected.length>=2&&(
        <div style={{marginTop:10}}>
          <label className="form-label">Winner</label>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {selected.map(id=>{
              const item=items.find(i=>i.id===id);
              const isWinner=selectedWinners.includes(id);
              return(<div key={id} className={`chip winner-chip${isWinner?" selected":""}`} onClick={()=>onWinnerToggle(id)}>{item?(renderLabel?renderLabel(item):item[labelKey]):"?"}</div>);
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────
function Modal({title,onClose,footer,children,maxWidth=520}){
  useEffect(()=>{
    const h=(e)=>{if(e.key==="Escape")onClose();};
    document.addEventListener("keydown",h);return()=>document.removeEventListener("keydown",h);
  },[onClose]);
  return(
    <div className="modal-overlay" onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="modal" style={{maxWidth}}>
        <div className="modal-header">
          <div className="modal-title" dangerouslySetInnerHTML={{__html:title}}/>
          <button className="modal-close" onClick={onClose}><i className="fas fa-times"/></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer&&<div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

function ConfirmModal({message,onConfirm,onClose,confirmLabel="Delete",confirmClass="btn-danger"}){
  return(
    <Modal title="Confirm" onClose={onClose} footer={
      <><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
      <button className={`btn ${confirmClass}`} onClick={()=>{onConfirm();onClose();}}>{confirmLabel}</button></>
    }>
      <p style={{color:"var(--text-secondary)",lineHeight:1.5}} dangerouslySetInnerHTML={{__html:message}}/>
    </Modal>
  );
}

// ─── Wrestler Modal ───────────────────────────────────────────────────────────
function WrestlerModal({wrestler,shows,onSave,onClose}){
  const [name,setName]=useState(wrestler?.name||"");
  const [nickname,setNickname]=useState(wrestler?.nickname||"");
  const [showId,setShowId]=useState(wrestler?.showId||"");
  const [image,setImage]=useState(wrestler?.image||"");
  const weekly=shows.filter(s=>(s.showType||"weekly")==="weekly");
  const save=()=>{
    if(!name.trim()){alert("Name required");return;}
    onSave({name:name.trim(),nickname:nickname.trim(),showId,image});
    onClose();
  };
  return(
    <Modal title={wrestler?"Edit Wrestler":"Add Wrestler"} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>{wrestler?"Update":"Add"} Wrestler</button></>}>
      <div className="form-group"><label className="form-label">Photo</label><ImageInput value={image} onChange={setImage} placeholder="fa-user" circle/></div>
      <div className="form-group"><label className="form-label">Name *</label><input autoFocus className="form-input" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Roman Reigns"/></div>
      <div className="form-group"><label className="form-label">Nickname</label><input className="form-input" value={nickname} onChange={e=>setNickname(e.target.value)} placeholder="e.g. The Tribal Chief"/></div>
      <div className="form-group"><label className="form-label">Show / Brand</label>
        <select className="form-select" value={showId} onChange={e=>setShowId(e.target.value)}>
          <option value="">— None —</option>
          {weekly.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
    </Modal>
  );
}

// ─── Show Modal ───────────────────────────────────────────────────────────────
function ShowModal({show,shows,onSave,onClose}){
  const [showType,setShowType]=useState(show?.showType||"weekly");
  const [name,setName]=useState(show?.name||"");
  const [day,setDay]=useState(show?.day||"");
  const [description,setDescription]=useState(show?.description||"");
  const [color,setColor]=useState(show?.color||SHOW_COLORS[0]);
  const [image,setImage]=useState(show?.image||"");
  const [pleDate,setPleDate]=useState(show?.pleDate||"");
  const [venue,setVenue]=useState(show?.venue||"");
  const [linkedShows,setLinkedShows]=useState(show?.linkedShows||[]);
  const weekly=shows.filter(s=>(s.showType||"weekly")==="weekly"&&s.id!==show?.id);
  const toggleLinked=(id)=>setLinkedShows(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  const save=()=>{
    if(!name.trim()){alert("Show name required");return;}
    onSave({name:name.trim(),day,description,color,image,showType,pleDate,venue,linkedShows});
    onClose();
  };
  return(
    <Modal title={show?"Edit Show":"Add Show / PLE"} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>{show?"Update":"Add"}</button></>}>
      <div className="form-group"><label className="form-label">Type</label>
        <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:"1px solid var(--border)"}}>
          {["weekly","ple"].map(t=>(
            <button key={t} type="button" onClick={()=>setShowType(t)}
              style={{flex:1,padding:"10px 16px",border:"none",background:showType===t?"var(--primary)":"var(--bg-input)",color:showType===t?"#fff":"var(--text-secondary)",fontFamily:"Teko,sans-serif",fontSize:16,fontWeight:600,textTransform:"uppercase",cursor:"pointer"}}>
              <i className={`fas ${t==="ple"?"fa-star":"fa-tv"}`}/> {t==="ple"?"PLE":"Weekly Show"}
            </button>
          ))}
        </div>
      </div>
      <div className="form-group"><label className="form-label">Logo / Image</label><ImageInput value={image} onChange={setImage} placeholder="fa-tv"/></div>
      <div className="form-group"><label className="form-label">Name *</label><input autoFocus className="form-input" value={name} onChange={e=>setName(e.target.value)} placeholder={showType==="ple"?"e.g. WrestleMania":"e.g. Monday Night RAW"}/></div>
      {showType==="weekly"&&<div className="form-group"><label className="form-label">Day</label><input className="form-input" value={day} onChange={e=>setDay(e.target.value)} placeholder="e.g. Monday"/></div>}
      {showType==="ple"&&<>
        <div style={{display:"flex",gap:10}}>
          <div className="form-group" style={{flex:1}}><label className="form-label">Event Date</label><input type="date" className="form-input" value={pleDate} onChange={e=>setPleDate(e.target.value)}/></div>
          <div className="form-group" style={{flex:1}}><label className="form-label">Venue</label><input className="form-input" value={venue} onChange={e=>setVenue(e.target.value)} placeholder="e.g. MetLife Stadium"/></div>
        </div>
        <div className="form-group"><label className="form-label">Featured Shows</label>
          {weekly.length?<div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:200,overflowY:"auto"}}>
            {weekly.map(ws=>(
              <label key={ws.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"var(--bg-input)",borderRadius:6,cursor:"pointer",border:"1px solid var(--border)"}}>
                <input type="checkbox" checked={linkedShows.includes(ws.id)} onChange={()=>toggleLinked(ws.id)} style={{width:16,height:16,accentColor:"var(--primary)"}}/>
                <span style={{display:"flex",alignItems:"center",gap:6,fontSize:14,fontWeight:500}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:ws.color,display:"inline-block"}}/>
                  {ws.name}
                </span>
              </label>
            ))}
          </div>:<p style={{color:"var(--text-muted)",fontStyle:"italic",fontSize:13}}>No weekly shows yet.</p>}
        </div>
      </>}
      <div className="form-group"><label className="form-label">Color</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {SHOW_COLORS.map(c=>(
            <div key={c} onClick={()=>setColor(c)}
              style={{width:32,height:32,borderRadius:6,background:c,cursor:"pointer",border:color===c?"3px solid #fff":"3px solid transparent",boxShadow:color===c?"0 0 0 2px "+c:"none"}}/>
          ))}
        </div>
      </div>
      <div className="form-group"><label className="form-label">Description</label><textarea className="form-textarea" value={description} onChange={e=>setDescription(e.target.value)} placeholder="Optional description..."/></div>
    </Modal>
  );
}

const GROUP_SIZES = [
  {size:2, label:"Tag Team", icon:"fa-people-group"},
  {size:3, label:"Trio",     icon:"fa-people-roof"},
  {size:4, label:"Stable (4)", icon:"fa-users"},
  {size:5, label:"Stable (5)", icon:"fa-users"},
  {size:6, label:"Stable (6)", icon:"fa-users"},
];
function groupTypeLabel(memberCount){
  if(memberCount<=2) return "Tag Team";
  if(memberCount===3) return "Trio";
  return "Stable";
}
function getGroupMembers(t){
  return t.memberIds&&t.memberIds.length ? t.memberIds.filter(Boolean) : [t.member1Id,t.member2Id].filter(Boolean);
}
function wName2(id,state){
  return (state.wrestlers.find(w=>w.id===id)||{}).name || "That wrestler";
}

// ─── Tag Team Modal ───────────────────────────────────────────────────────────
function TagTeamModal({team,wrestlers,onSave,onClose}){
  // Migrate old member1Id/member2Id format on load
  const initMembers = team
    ? (team.memberIds && team.memberIds.length
        ? [...team.memberIds]
        : [team.member1Id, team.member2Id].filter(Boolean))
    : [];
  const initSize = initMembers.length >= 2 ? initMembers.length : 2;

  const [name,setName]=useState(team?.name||"");
  const [size,setSize]=useState(initSize);
  const [members,setMembers]=useState(()=>{
    const arr=[...initMembers];
    while(arr.length<initSize) arr.push("");
    return arr.slice(0,initSize);
  });

  const adjustSize=(newSize)=>{
    setSize(newSize);
    setMembers(p=>{
      const arr=[...p];
      while(arr.length<newSize) arr.push("");
      return arr.slice(0,newSize);
    });
  };

  const setMember=(idx,val)=>setMembers(p=>{const a=[...p];a[idx]=val;return a;});

  const save=()=>{
    if(!name.trim()){alert("Name required");return;}
    const filled=members.filter(Boolean);
    if(filled.length<2){alert("At least 2 members required");return;}
    const unique=new Set(filled);
    if(unique.size!==filled.length){alert("Members must all be different");return;}
    // Keep member1Id/member2Id for backwards compat, plus new memberIds array
    onSave({name:name.trim(),memberIds:members,member1Id:members[0]||"",member2Id:members[1]||""});
    onClose();
  };

  const gtInfo = GROUP_SIZES.find(g=>g.size===size)||GROUP_SIZES[0];

  return(
    <Modal title={team?`Edit ${groupTypeLabel(size)}`:`Add Group`} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>{team?"Update":"Add"} {gtInfo.label}</button></>}>

      <div className="form-group"><label className="form-label">Group Name *</label>
        <input autoFocus className="form-input" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. The Bloodline, The Shield..."/>
      </div>

      <div className="form-group"><label className="form-label">Group Type</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {GROUP_SIZES.map(g=>(
            <div key={g.size} className={`chip${size===g.size?" selected":""}`} onClick={()=>adjustSize(g.size)}>
              <i className={`fas ${g.icon}`} style={{marginRight:5}}/>{g.label}
            </div>
          ))}
        </div>
      </div>

      <div className="form-group"><label className="form-label">Members ({size})</label>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {members.map((mid,idx)=>(
            <div key={idx} style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{width:22,height:22,borderRadius:"50%",background:"var(--bg-input)",border:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"var(--text-muted)",flexShrink:0}}>{idx+1}</span>
              <select className="form-select" style={{flex:1}} value={mid} onChange={e=>setMember(idx,e.target.value)}>
                <option value="">— Select wrestler —</option>
                {wrestlers.map(w=>{
                  const takenElsewhere=members.some((m,i)=>i!==idx&&m===w.id);
                  return <option key={w.id} value={w.id} disabled={takenElsewhere}>{w.name}{takenElsewhere?" (already selected)":""}</option>;
                })}
              </select>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// ─── Championship Modal ───────────────────────────────────────────────────────
function ChampionshipModal({champ,shows,wrestlers,tagTeams,onSave,onClose}){
  const [name,setName]=useState(champ?.name||"");
  const [type,setType]=useState(champ?.type||"singles");
  const [showId,setShowId]=useState(champ?.showId||"");
  const [holderId,setHolderId]=useState(champ?.currentHolderId||"");
  const [image,setImage]=useState(champ?.image||"");
  const weekly=shows.filter(s=>(s.showType||"weekly")==="weekly");
  const holders=type==="tag"?tagTeams:wrestlers;
  const save=()=>{
    if(!name.trim()){alert("Name required");return;}
    onSave({name:name.trim(),type,showId,holderId,image});
    onClose();
  };
  return(
    <Modal title={champ?"Edit Championship":"Add Championship"} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>{champ?"Update":"Add"}</button></>}>
      <div className="form-group"><label className="form-label">{type==="mitb"?"Briefcase Image":"Belt Image"}</label><ImageInput value={image} onChange={setImage} placeholder={type==="mitb"?"fa-briefcase":"fa-trophy"}/></div>
      <div className="form-group"><label className="form-label">Name *</label><input autoFocus className="form-input" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. World Heavyweight Championship"/></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div className="form-group"><label className="form-label">Type *</label>
          <select className="form-select" value={type} onChange={e=>{setType(e.target.value);setHolderId("");}}>
            <option value="singles">Singles</option>
            <option value="tag">Tag / Group</option>
            <option value="mitb">Money in the Bank</option>
          </select>
          {champ&&type!==champ.type&&<div className="form-hint" style={{color:"var(--error)"}}><i className="fas fa-triangle-exclamation"/> Changing type clears this title's reign history.</div>}
        </div>
        <div className="form-group"><label className="form-label">Show</label>
          <select className="form-select" value={showId} onChange={e=>setShowId(e.target.value)}>
            <option value="">— None —</option>
            {weekly.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group"><label className="form-label">{type==="mitb"?"Briefcase Holder":"Current Holder"}</label>
        <select className="form-select" value={holderId} onChange={e=>setHolderId(e.target.value)}>
          <option value="">Vacant</option>
          {holders.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </div>
    </Modal>
  );
}

// ─── Match Modal ──────────────────────────────────────────────────────────────
// For tag-style matches, each "slot" is either:
//   {kind:"group", groupId}                      — an existing saved Tag Team/Trio/Stable
//   {kind:"adhoc", id, label, memberIds:[...]}    — a one-off team built just for this match
function MatchModal({match,state,onSave,onClose,toast}){
  const [matchType,setMatchType]=useState(match?.matchType||"singles");
  const [selWrestlers,setSelWrestlers]=useState(()=>{
    if(!match)return[];
    // Don't pre-populate for tag matches — wrestlers array contains all member IDs from all teams
    const mt0=match.matchType;
    const isTagMatch=match.tagTeamIds&&match.tagTeamIds.length>0;
    if(isTagMatch)return[];
    return match.wrestlers||[];
  });
  const [winnerId,setWinnerId]=useState(match?.winnerIds?.[0]||null);
  const [date,setDate]=useState(match?.date||new Date().toISOString().slice(0,10));
  const [showId,setShowId]=useState(match?.showId||"");
  const [isChamp,setIsChamp]=useState(match?.isChampionshipMatch||false);
  // Support both old single championshipId and new multiple championshipIds
  const [champIds,setChampIds]=useState(()=>{
    if(!match)return[];
    if(match.championshipIds&&match.championshipIds.length)return match.championshipIds;
    if(match.championshipId)return[match.championshipId];
    return[];
  });
  const [notes,setNotes]=useState(match?.notes||"");

  // Rebuild slots from an existing match (groups + adhoc teams)
  const initSlots=()=>{
    if(!match)return[];
    const slots=[];
    (match.tagTeamIds||[]).forEach(tid=>{
      // Find any activeMembers stored on the match for this slot
      const am=(match.slotActiveMembers||{})[tid]||[];
      slots.push({kind:"group",groupId:tid,id:tid,activeMembers:am});
    });
    (match.adhocTeams||[]).forEach(at=>slots.push({kind:"adhoc",id:at.id,label:at.label,memberIds:at.memberIds,activeMembers:[]}));
    return slots;
  };
  const [slots,setSlots]=useState(initSlots);
  const [winnerSlotId,setWinnerSlotId]=useState(()=>{
    if(!match)return null;
    if(match.winnerTagTeamId)return match.winnerTagTeamId;
    if(match.winnerAdhocId)return match.winnerAdhocId;
    return null;
  });
  const [addMode,setAddMode]=useState("group"); // "group" | "adhoc"
  const [adhocPicker,setAdhocPicker]=useState([]); // wrestlers being picked for new adhoc team
  const [adhocLabel,setAdhocLabel]=useState("");

  const mt=state.matchTypes.find(t=>t.id===matchType)||state.matchTypes[0];
  const isTag=mt?.isTag;

  const slotMembers=(slot)=>{
    // If activeMembers is set, use that subset — otherwise use all group members
    if(slot.activeMembers&&slot.activeMembers.length>0)return slot.activeMembers;
    if(slot.kind==="group"){
      const t=state.tagTeams.find(x=>x.id===slot.groupId);
      return t?getGroupMembers(t):[];
    }
    return slot.memberIds||[];
  };
  const slotAllMembers=(slot)=>{
    // Always returns the full roster of the group/adhoc, ignoring activeMembers
    if(slot.kind==="group"){
      const t=state.tagTeams.find(x=>x.id===slot.groupId);
      return t?getGroupMembers(t):[];
    }
    return slot.memberIds||[];
  };
  const slotName=(slot)=>{
    if(slot.kind==="group")return (state.tagTeams.find(x=>x.id===slot.groupId)||{}).name||"?";
    return slot.label||"Ad-Hoc Team";
  };

  const allUsedMembers=(excludeSlotId)=>{
    const set=new Set();
    slots.forEach(s=>{if(s.id!==excludeSlotId)slotMembers(s).forEach(m=>set.add(m));});
    return set;
  };

  const toggleSlotMember=(slotId,wid)=>{
    setSlots(p=>p.map(s=>{
      if(s.id!==slotId)return s;
      const all=slotAllMembers(s);
      const current=s.activeMembers&&s.activeMembers.length>0?s.activeMembers:[...all];
      const next=current.includes(wid)
        ?current.filter(x=>x!==wid)
        :[...current,wid];
      // Must keep at least 1 member
      if(next.length<1)return s;
      // If all members selected, clear activeMembers (means "all")
      return {...s,activeMembers:next.length===all.length?[]:next};
    }));
    // If the winner was this slot, their winnerIds will update automatically via slotMembers
  };

  const toggleW=(id)=>{
    setSelWrestlers(p=>{
      if(p.includes(id)){if(winnerId===id)setWinnerId(null);return p.filter(x=>x!==id);}
      if(p.length<(mt?.participants||2))return [...p,id];
      return p;
    });
  };

  const addGroupSlot=(groupId)=>{
    if(slots.length>=(mt?.participants||2))return;
    const t=state.tagTeams.find(x=>x.id===groupId);
    const members=t?getGroupMembers(t):[];
    const used=allUsedMembers(null);
    const clash=members.find(m=>used.has(m));
    if(clash){toast(`Can't add — ${wName2(clash,state)} is already in another slot`,"error");return;}
    setSlots(p=>[...p,{kind:"group",groupId,id:groupId}]);
  };

  const removeSlot=(slotId)=>{
    setSlots(p=>p.filter(s=>s.id!==slotId));
    if(winnerSlotId===slotId)setWinnerSlotId(null);
  };

  const toggleAdhocPick=(wid)=>{
    setAdhocPicker(p=>p.includes(wid)?p.filter(x=>x!==wid):[...p,wid]);
  };

  const confirmAdhocSlot=()=>{
    if(slots.length>=(mt?.participants||2)){toast("Match is full","error");return;}
    if(adhocPicker.length<1){toast("Pick at least 1 wrestler for this team","error");return;}
    const used=allUsedMembers(null);
    const clash=adhocPicker.find(m=>used.has(m));
    if(clash){toast(`Can't add — ${wName2(clash,state)} is already in another slot`,"error");return;}
    const id="adhoc-"+uid();
    const label=adhocLabel.trim()||adhocPicker.map(w=>wName2(w,state)).join(" & ");
    setSlots(p=>[...p,{kind:"adhoc",id,label,memberIds:[...adhocPicker]}]);
    setAdhocPicker([]);setAdhocLabel("");
  };

  const champOptions=state.championships.filter(c=>{
    if(isTag)return c.type==="tag";
    return c.type==="singles"||c.type==="mitb";
  });

  const save=()=>{
    if(!date){toast("Date required","error");return;}
    let wrestlers=[],tagTeamIds=null,adhocTeams=null,winnerIds=[],winnerTagTeamId=null,winnerAdhocId=null,slotActiveMembers=null;
    if(isTag){
      if(slots.length<(mt?.participants||2)){toast("Add "+mt?.participants+" teams to this match","error");return;}
      if(!winnerSlotId){toast("Select a winner","error");return;}
      // Validate every slot has at least 1 active member
      for(const s of slots){
        if(slotMembers(s).length<1){toast(`"${slotName(s)}" has no competing members selected — pick at least 1`,"error");return;}
      }
      tagTeamIds=slots.filter(s=>s.kind==="group").map(s=>s.groupId);
      adhocTeams=slots.filter(s=>s.kind==="adhoc").map(s=>({id:s.id,label:s.label,memberIds:s.memberIds}));
      // Build slotActiveMembers map so we can restore selections when editing
      slotActiveMembers={};
      slots.forEach(s=>{if(s.kind==="group"&&s.activeMembers&&s.activeMembers.length>0)slotActiveMembers[s.groupId]=s.activeMembers;});
      // Only include actually-competing members in the wrestlers array
      slots.forEach(s=>wrestlers.push(...slotMembers(s)));
      // Final safety check: no wrestler should appear in more than one slot
      const seen=new Set();
      for(const wid of wrestlers){
        if(seen.has(wid)){toast(`${wName2(wid,state)} appears in more than one team — fix the lineup before saving`,"error");return;}
        seen.add(wid);
      }
      const winnerSlot=slots.find(s=>s.id===winnerSlotId);
      if(winnerSlot){
        if(isChamp&&winnerSlot.kind==="adhoc"){
          toast("Championship matches need the winning team to be a saved Group, not an ad-hoc team — titles need a permanent holder","error");
          return;
        }
        winnerIds=slotMembers(winnerSlot);
        if(winnerSlot.kind==="group")winnerTagTeamId=winnerSlot.groupId;
        else winnerAdhocId=winnerSlot.id;
      }
    }else{
      if(selWrestlers.length<(mt?.participants||2)){toast("Select "+mt?.participants+" wrestlers","error");return;}
      if(!winnerId){toast("Select a winner","error");return;}
      wrestlers=[...selWrestlers];winnerIds=[winnerId];
    }
    if(isChamp&&champIds.length===0){toast("Select at least one championship","error");return;}
    onSave({date,showId,matchType,wrestlers,tagTeamIds,adhocTeams,slotActiveMembers:slotActiveMembers||undefined,winnerIds,winnerTagTeamId,winnerAdhocId,isChampionshipMatch:isChamp,championshipIds:isChamp?champIds:[],championshipId:isChamp&&champIds.length>0?champIds[0]:"",notes});
    onClose();
  };

  return(
    <Modal title={match?"Edit Match":"Record Match"} onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>{match?"Update":"Record"} Match</button></>}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div className="form-group"><label className="form-label">Date *</label><input type="date" className="form-input" value={date} onChange={e=>setDate(e.target.value)}/></div>
        <div className="form-group"><label className="form-label">Show</label>
          <select className="form-select" value={showId} onChange={e=>setShowId(e.target.value)}>
            <option value="">— None —</option>
            {state.shows.filter(s=>(s.showType||"weekly")==="weekly").map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            {state.shows.filter(s=>s.showType==="ple").map(s=><option key={s.id} value={s.id}>{s.name}{s.pleDate?" ("+fmtDate(s.pleDate)+")":""}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group"><label className="form-label">Match Type</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {state.matchTypes.map(t=>(
            <div key={t.id} className={`chip${matchType===t.id?" selected":""}`}
              onClick={()=>{setMatchType(t.id);setSelWrestlers([]);setSlots([]);setWinnerId(null);setWinnerSlotId(null);setAdhocPicker([]);setAdhocLabel("");}}>
              {t.name}
            </div>
          ))}
        </div>
      </div>
      {isTag?(
        <div className="form-group">
          <label className="form-label">Teams ({slots.length} / {mt?.participants})</label>

          {/* Current slots */}
          {slots.length>0&&<div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
            {slots.map(slot=>{
              const allMids=slotAllMembers(slot);
              const activeMids=slotMembers(slot);
              const isWinner=winnerSlotId===slot.id;
              const isLargeGroup=allMids.length>2;
              return(
                <div key={slot.id} style={{background:isWinner?"rgba(34,197,94,0.08)":"var(--bg-input)",borderRadius:8,border:`1px solid ${isWinner?"var(--success)":"var(--border)"}`,overflow:"hidden"}}>
                  {/* Slot header */}
                  <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px"}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:14,display:"flex",alignItems:"center",gap:6}}>
                        {slot.kind==="adhoc"&&<i className="fas fa-link-slash" style={{fontSize:11,color:"var(--text-muted)"}} title="Ad-hoc team"/>}
                        {slotName(slot)}
                        {isWinner&&<span style={{fontSize:10,fontWeight:700,textTransform:"uppercase",padding:"1px 6px",borderRadius:3,background:"var(--success)",color:"#fff"}}>Winner</span>}
                      </div>
                      <div style={{fontSize:12,color:"var(--text-muted)",marginTop:2}}>
                        {activeMids.map(mid=>wName2(mid,state)).join(", ")||"No members selected"}
                        {isLargeGroup&&<span style={{marginLeft:6,color:"var(--accent)",fontWeight:600}}>({activeMids.length}/{allMids.length} competing)</span>}
                      </div>
                    </div>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={()=>{
                        if(isChamp&&champIds.length>0&&slot.kind==="adhoc"){toast("Ad-hoc teams can't hold championships — pick a saved Group as the winner","error");return;}
                        setWinnerSlotId(slot.id);
                      }} disabled={isWinner}>
                      {isWinner?<i className="fas fa-check"/>:"Set Winner"}
                    </button>
                    <button type="button" className="card-action-btn delete" onClick={()=>removeSlot(slot.id)}><i className="fas fa-trash"/></button>
                  </div>
                  {/* Member picker — only shown for trios/stables (more than 2 members) */}
                  {isLargeGroup&&(
                    <div style={{padding:"8px 12px 12px",borderTop:"1px solid var(--border)",background:"var(--bg-deep)"}}>
                      <div style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginBottom:6}}>
                        <i className="fas fa-users"/> Select who's competing from this group:
                      </div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {allMids.map(mid=>{
                          const isActive=activeMids.includes(mid);
                          return(
                            <div key={mid}
                              className={`chip${isActive?" selected":""}`}
                              onClick={()=>toggleSlotMember(slot.id,mid)}
                              style={{fontSize:12,padding:"4px 10px"}}>
                              {wName2(mid,state)}
                              {isActive&&<i className="fas fa-check" style={{marginLeft:5,fontSize:10}}/>}
                            </div>
                          );
                        })}
                      </div>
                      {activeMids.length<1&&<div style={{fontSize:12,color:"var(--error)",marginTop:6}}><i className="fas fa-triangle-exclamation"/> Select at least 1 competing member</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>}

          {/* Add new slot */}
          {slots.length<(mt?.participants||2)&&<div style={{border:"1px solid var(--border)",borderRadius:8,padding:12}}>
            <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:"1px solid var(--border)",marginBottom:10}}>
              {[{id:"group",label:"Existing Group",icon:"fa-people-group"},{id:"adhoc",label:"Ad-Hoc Team",icon:"fa-link"}].map(m=>(
                <button key={m.id} type="button" onClick={()=>{setAddMode(m.id);setAdhocPicker([]);setAdhocLabel("");}}
                  style={{flex:1,padding:"8px 12px",border:"none",background:addMode===m.id?"var(--primary)":"var(--bg-input)",color:addMode===m.id?"#fff":"var(--text-secondary)",fontFamily:"Teko,sans-serif",fontSize:14,fontWeight:600,textTransform:"uppercase",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  <i className={`fas ${m.icon}`}/> {m.label}
                </button>
              ))}
            </div>

            {addMode==="group"?(
              <div>
                <div style={{fontSize:12,color:"var(--text-muted)",marginBottom:8}}>Pick a saved Tag Team, Trio, or Stable to add as the next team.</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,maxHeight:160,overflowY:"auto"}}>
                  {state.tagTeams.map(t=>{
                    const used=allUsedMembers(null);
                    const mids=getGroupMembers(t);
                    const alreadyIn=slots.some(s=>s.kind==="group"&&s.groupId===t.id);
                    const clash=!alreadyIn&&mids.some(m=>used.has(m));
                    const disabled=alreadyIn||clash;
                    return(
                      <div key={t.id} className="chip" title={clash?"Shares a member with a team already in this match":alreadyIn?"Already added":undefined}
                        style={{opacity:disabled?0.4:1,cursor:disabled?"not-allowed":"pointer",pointerEvents:disabled?"none":"auto",outline:clash?"1px dashed var(--error)":"none"}}
                        onClick={()=>addGroupSlot(t.id)}>
                        {t.name} <span style={{opacity:0.7,fontSize:11}}>({mids.length})</span>
                        {clash&&<i className="fas fa-triangle-exclamation" style={{marginLeft:5,color:"var(--error)",fontSize:10}}/>}
                      </div>
                    );
                  })}
                  {state.tagTeams.length===0&&<span style={{color:"var(--text-muted)",fontStyle:"italic",fontSize:13}}>No saved groups yet — try Ad-Hoc Team instead.</span>}
                </div>
              </div>
            ):(
              <div>
                <div style={{fontSize:12,color:"var(--text-muted)",marginBottom:8}}>Pick wrestlers who are partnering up just for this match — no need to save them as a permanent group.</div>
                <input className="form-input" style={{marginBottom:8,fontSize:14,padding:"8px 12px"}} placeholder="Team label (optional, e.g. 'Random Partners')" value={adhocLabel} onChange={e=>setAdhocLabel(e.target.value)}/>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,maxHeight:160,overflowY:"auto",marginBottom:10}}>
                  {state.wrestlers.map(w=>{
                    const used=allUsedMembers(null);
                    const sel=adhocPicker.includes(w.id);
                    const disabled=!sel&&used.has(w.id);
                    return(
                      <div key={w.id} className={`chip${sel?" selected":""}`}
                        title={disabled?"Already in another team in this match":undefined}
                        style={{opacity:disabled?0.4:1,cursor:disabled?"not-allowed":"pointer",pointerEvents:disabled?"none":"auto"}}
                        onClick={()=>toggleAdhocPick(w.id)}>{w.name}</div>
                    );
                  })}
                </div>
                <button type="button" className="btn btn-primary btn-sm" onClick={confirmAdhocSlot} disabled={adhocPicker.length<1}>
                  <i className="fas fa-plus"/> Add This Team ({adhocPicker.length} {adhocPicker.length===1?"member":"members"})
                </button>
              </div>
            )}
          </div>}
        </div>
      ):(
        <div className="form-group"><label className="form-label">Select {mt?.participants} Wrestlers</label>
          <ChipSelector items={state.wrestlers} selected={selWrestlers} onToggle={toggleW} max={mt?.participants}
            winnerMode selectedWinners={winnerId?[winnerId]:[]} onWinnerToggle={id=>setWinnerId(id)}/>
        </div>
      )}
      <div className="form-group">
        <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",fontSize:14}}>
          <input type="checkbox" checked={isChamp} onChange={e=>{setIsChamp(e.target.checked);if(!e.target.checked)setChampIds([]);}} style={{width:18,height:18,accentColor:"var(--primary)"}}/>
          Championship Match
        </label>
      </div>
      {isChamp&&<div className="form-group">
        <label className="form-label">Championships on the Line</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:8}}>
          {champOptions.map(c=>{
            const sel=champIds.includes(c.id);
            return(
              <div key={c.id} className={`chip${sel?" selected":""}`}
                onClick={()=>setChampIds(p=>sel?p.filter(x=>x!==c.id):[...p,c.id])}>
                {c.type==="mitb"?<i className="fas fa-briefcase" style={{marginRight:4}}/>:<i className="fas fa-trophy" style={{marginRight:4,opacity:0.7}}/>}
                {c.name}
                {sel&&<i className="fas fa-check" style={{marginLeft:5,fontSize:10}}/>}
              </div>
            );
          })}
          {champOptions.length===0&&<span style={{color:"var(--text-muted)",fontStyle:"italic",fontSize:13}}>No championships available for this match type.</span>}
        </div>
        {champIds.length>1&&<div style={{padding:"6px 10px",background:"rgba(255,215,0,0.08)",border:"1px solid rgba(255,215,0,0.2)",borderRadius:6,fontSize:12,color:"var(--accent)"}}>
          <i className="fas fa-crown"/> {champIds.length} titles on the line — the winner takes all.
        </div>}
        {match&&<div className="form-hint" style={{marginTop:6}}>
          <i className="fas fa-circle-info"/> Editing won't re-apply title changes or defense counts — delete and re-record to correct a title result.
        </div>}
      </div>}
      <div className="form-group"><label className="form-label">Notes</label><input className="form-input" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="e.g. Stipulation, finish type..."/></div>
    </Modal>
  );
}

// ─── MITB Cash In Modal ───────────────────────────────────────────────────────
function CashInModal({mitb,state,onCashIn,onClose}){
  const holderName=(state.wrestlers.find(w=>w.id===mitb.currentHolderId)||{}).name||"?";
  const [targetId,setTargetId]=useState("");
  const [result,setResult]=useState("won");
  const [cashDate,setCashDate]=useState(new Date().toISOString().slice(0,10));
  const targets=state.championships.filter(c=>c.type==="singles"&&c.id!==mitb.id);
  const go=()=>{
    if(!targetId){alert("Select a championship");return;}
    onCashIn(mitb.id,targetId,result,cashDate);
    onClose();
  };
  return(
    <Modal title="Money in the Bank Cash In" onClose={onClose}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" style={{background:"linear-gradient(135deg,#16a34a,#22c55e)"}} onClick={go}><i className="fas fa-bolt"/> Cash In!</button></>}>
      <div style={{textAlign:"center",marginBottom:16}}>
        <i className="fas fa-briefcase" style={{fontSize:40,color:"var(--success)"}}/>
        <div style={{fontFamily:"Teko,sans-serif",fontSize:24,fontWeight:700,textTransform:"uppercase",color:"var(--success)",marginTop:8}}>{holderName} is cashing in!</div>
      </div>
      <div className="form-group"><label className="form-label">Cash In On</label>
        <select className="form-select" value={targetId} onChange={e=>setTargetId(e.target.value)}>
          <option value="">— Select Championship —</option>
          {targets.map(c=>{
            const holder=c.currentHolderId?(state.wrestlers.find(w=>w.id===c.currentHolderId)||{}).name||"?":"Vacant";
            return<option key={c.id} value={c.id}>{c.name} ({holder})</option>;
          })}
        </select>
      </div>
      <div className="form-group"><label className="form-label">Result</label>
        <select className="form-select" value={result} onChange={e=>setResult(e.target.value)}>
          <option value="won">Won the Title</option>
          <option value="lost">Failed Cash In</option>
        </select>
      </div>
      <div className="form-group"><label className="form-label">Date</label><input type="date" className="form-input" value={cashDate} onChange={e=>setCashDate(e.target.value)}/></div>
    </Modal>
  );
}

// ─── Match Type Manager ───────────────────────────────────────────────────────
function MatchTypesModal({matchTypes,onSave,onDelete,onClose}){
  const [editing,setEditing]=useState(null);
  const [mtName,setMtName]=useState("");
  const [mtParts,setMtParts]=useState(2);
  const [mtIsTag,setMtIsTag]=useState(false);
  const startEdit=(t)=>{setEditing(t||"new");setMtName(t?.name||"");setMtParts(t?.participants||2);setMtIsTag(t?.isTag||false);};
  const saveType=()=>{
    if(!mtName.trim()||mtParts<2){alert("Name and min 2 participants required");return;}
    onSave(editing==="new"?null:editing,{name:mtName.trim(),participants:+mtParts,isTag:mtIsTag});
    setEditing(null);
  };
  if(editing!==null){
    return(
      <Modal title={editing==="new"?"Add Match Type":"Edit Match Type"} onClose={()=>setEditing(null)}
        footer={<><button className="btn btn-secondary" onClick={()=>setEditing(null)}>Back</button><button className="btn btn-primary" onClick={saveType}>{editing==="new"?"Add":"Update"} Type</button></>}>
        <div className="form-group"><label className="form-label">Name *</label><input autoFocus className="form-input" value={mtName} onChange={e=>setMtName(e.target.value)} placeholder="e.g. Ladder Match, Tag Triple Threat..."/></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div className="form-group"><label className="form-label">{mtIsTag?"Number of Teams *":"Participants *"}</label><input type="number" className="form-input" min={2} max={10} value={mtParts} onChange={e=>setMtParts(e.target.value)}/></div>
          <div className="form-group"><label className="form-label">Type</label>
            <select className="form-select" value={mtIsTag?"true":"false"} onChange={e=>setMtIsTag(e.target.value==="true")}>
              <option value="false">Individual Wrestlers</option>
              <option value="true">Tag Teams / Groups</option>
            </select>
          </div>
        </div>
        <div className="form-hint" style={{marginTop:-8}}>
          {mtIsTag
            ? `This sets how many groups compete — each group can be a Tag Team, Trio, or Stable of any size (set per-group under the Groups tab). E.g. ${mtParts} teams x 3-member trios = a ${mtParts*3}-person tag match.`
            : "This sets how many individual wrestlers compete in the match."}
        </div>
      </Modal>
    );
  }
  return(
    <Modal title="Manage Match Types" onClose={onClose}>
      <button className="btn btn-primary btn-sm" style={{width:"100%",marginBottom:14}} onClick={()=>startEdit(null)}><i className="fas fa-plus"/> Add Match Type</button>
      {matchTypes.map(t=>(
        <div key={t.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 12px",background:"var(--bg-input)",borderRadius:6,marginBottom:6}}>
          <div>
            <div style={{fontFamily:"Teko,sans-serif",fontSize:18,fontWeight:600,textTransform:"uppercase"}}>{t.name}</div>
            <div style={{fontSize:12,color:"var(--text-muted)",display:"flex",gap:8}}>
              <span>{t.participants} {t.isTag?"teams":"wrestlers"}</span>
              {t.isTag&&<span style={{color:"var(--accent)"}}>Tag</span>}
              {t.isDefault&&<span style={{fontStyle:"italic"}}>Built-in</span>}
            </div>
          </div>
          <div style={{display:"flex",gap:4}}>
            <button className="card-action-btn" onClick={()=>startEdit(t)}><i className="fas fa-pen"/></button>
            {!t.isDefault&&<button className="card-action-btn delete" onClick={()=>onDelete(t.id)}><i className="fas fa-trash"/></button>}
          </div>
        </div>
      ))}
    </Modal>
  );
}

// ─── Wrestler Profile ─────────────────────────────────────────────────────────
function WrestlerProfile({w,state,onClose}){
  const rec=getRecord(w.id,state.matches);
  const rating=getPowerRating(w.id,state);
  const streak=getStreak(w.id,state.matches);
  const champs=getCurrentChampionships(w.id,state.championships);
  const show=state.shows.find(s=>s.id===w.showId);
  const winPct=rec.total>0?Math.round(rec.pct*100):0;
  const mitbHeld=state.championships.filter(c=>c.type==="mitb"&&c.currentHolderId===w.id);
  const recentMatches=sa(state.matches).filter(m=>sa(m.wrestlers).includes(w.id)).sort((a,b)=>{const d=new Date(b.date)-new Date(a.date);return d!==0?d:state.matches.indexOf(b)-state.matches.indexOf(a);}).slice(0,10);
  const allMatches=sa(state.matches).filter(m=>sa(m.wrestlers).includes(w.id)).sort((a,b)=>{const d=new Date(b.date)-new Date(a.date);return d!==0?d:state.matches.indexOf(b)-state.matches.indexOf(a);}).slice(0,15);
  const pastReigns=[];
  sa(state.championships).forEach(c=>{if(c.type!=="singles")return;sa(c.history).forEach(h=>{if(h.holderId===w.id)pastReigns.push({c,h});});});

  // Groups this wrestler belongs to
  const myGroups=state.tagTeams.filter(t=>getGroupMembers(t).includes(w.id));

  const groupTypeColor=(n)=>n===2?"var(--primary)":n===3?"var(--success)":"var(--accent)";

  return(
    <Modal title={`${w.name} — Profile`} onClose={onClose} footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:18}}>
        <div style={{width:80,height:80,borderRadius:"50%",overflow:"hidden",border:"3px solid var(--accent)",background:"var(--bg-input)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          {w.image?<img src={w.image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<i className="fas fa-user" style={{fontSize:32,color:"var(--text-muted)"}}/>}
        </div>
        <div>
          <div style={{fontFamily:"Teko,sans-serif",fontSize:30,fontWeight:700,textTransform:"uppercase",lineHeight:1}}>{w.name}</div>
          {w.nickname&&<div style={{fontSize:14,color:"var(--accent)",fontStyle:"italic",marginTop:2}}>"{w.nickname}"</div>}
          {show&&<div style={{fontSize:12,color:"var(--text-secondary)",marginTop:4,display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:show.color,display:"inline-block"}}/>{show.name}</div>}
          {myGroups.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
            {myGroups.map(t=>{const n=getGroupMembers(t).length;const col=groupTypeColor(n);return(
              <span key={t.id} style={{fontSize:11,fontWeight:700,textTransform:"uppercase",padding:"2px 8px",borderRadius:20,background:col+"22",color:col,border:`1px solid ${col}44`}}>
                <i className="fas fa-people-group" style={{marginRight:4}}/>{t.name}
              </span>
            );})}
          </div>}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
        {[{v:rec.wins,l:"Wins",c:"var(--success)"},{v:rec.losses,l:"Losses",c:"var(--error)"},{v:winPct+"%",l:"Win Rate",c:"var(--accent)"},{v:rating,l:"Power",c:"var(--primary)"}].map(({v,l,c})=>(
          <div key={l} style={{background:"var(--bg-input)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"Teko,sans-serif",fontSize:26,fontWeight:700,lineHeight:1,color:c}}>{v}</div>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.5px",color:"var(--text-muted)",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{height:10,borderRadius:5,background:"var(--bg-input)",overflow:"hidden",display:"flex",marginBottom:16}}>
        <div style={{width:(rec.total>0?rec.wins/rec.total*100:0)+"%",background:"var(--success)"}}/>
        <div style={{width:(rec.total>0?rec.losses/rec.total*100:0)+"%",background:"var(--error)"}}/>
      </div>
      {recentMatches.length>0&&<><div style={{fontFamily:"Teko,sans-serif",fontSize:16,fontWeight:600,textTransform:"uppercase",color:"var(--text-muted)",marginBottom:8,borderBottom:"1px solid var(--border)",paddingBottom:4}}>Recent Form</div>
        <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:12,color:"var(--text-muted)"}}>Last {recentMatches.length}:</span>
          {recentMatches.map((m,i)=>{const w2=sa(m.winnerIds).includes(w.id);return(<div key={i} style={{width:28,height:28,borderRadius:"50%",background:w2?"var(--success)":"var(--error)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff"}}>{w2?"W":"L"}</div>);})}
        </div></>}
      {streak!==0&&<div style={{display:"inline-flex",alignItems:"center",gap:4,padding:"4px 12px",borderRadius:20,fontSize:13,fontWeight:700,marginBottom:16,background:streak>0?"rgba(34,197,94,0.15)":"rgba(239,68,68,0.15)",color:streak>0?"var(--success)":"var(--error)"}}>
        {streak>0?`🔥 ${streak} Win Streak`:`❌ ${Math.abs(streak)} Loss Streak`}
      </div>}
      {mitbHeld.length>0&&<><div style={{fontFamily:"Teko,sans-serif",fontSize:16,fontWeight:600,textTransform:"uppercase",color:"var(--success)",marginBottom:8,borderBottom:"1px solid var(--border)",paddingBottom:4}}><i className="fas fa-briefcase"/> Money in the Bank</div>
        {mitbHeld.map(c=><div key={c.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:"var(--bg-input)",borderRadius:6,marginBottom:6,border:"1px solid rgba(34,197,94,0.2)"}}>
          <i className="fas fa-briefcase" style={{color:"var(--success)",fontSize:20}}/>
          <div><div style={{fontWeight:600,fontSize:14,color:"var(--success)"}}>{c.name}</div><div style={{fontSize:12,color:"var(--text-muted)"}}>Briefcase Holder</div></div>
        </div>)}</>}
      {champs.length>0&&<><div style={{fontFamily:"Teko,sans-serif",fontSize:16,fontWeight:600,textTransform:"uppercase",color:"var(--text-muted)",marginBottom:8,borderBottom:"1px solid var(--border)",paddingBottom:4}}>Current Championships</div>
        {champs.map(c=><div key={c.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:"var(--bg-input)",borderRadius:6,marginBottom:6,border:"1px solid rgba(255,215,0,0.15)"}}>
          {c.image?<img src={c.image} alt="" style={{width:32,height:32,objectFit:"contain"}}/>:<i className="fas fa-trophy" style={{color:"var(--accent)",fontSize:20}}/>}
          <div><div style={{fontWeight:600,fontSize:14,color:"var(--accent)"}}>{c.name}</div><div style={{fontSize:12,color:"var(--text-muted)"}}>{c.defenses} defense{c.defenses!==1?"s":""}</div></div>
        </div>)}</>}
      {myGroups.length>0&&<><div style={{fontFamily:"Teko,sans-serif",fontSize:16,fontWeight:600,textTransform:"uppercase",color:"var(--text-muted)",marginTop:12,marginBottom:8,borderBottom:"1px solid var(--border)",paddingBottom:4}}>Groups & Affiliations</div>
        {myGroups.map(t=>{
          const mids=getGroupMembers(t);const n=mids.length;const col=groupTypeColor(n);
          const rec2=getTagRecord(t.id,state.matches);
          return(<div key={t.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"var(--bg-input)",borderRadius:6,marginBottom:6,border:`1px solid ${col}33`}}>
            <div style={{width:36,height:36,borderRadius:6,background:col+"22",border:`1px solid ${col}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <i className="fas fa-people-group" style={{color:col,fontSize:16}}/>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:700,fontSize:14,color:col}}>{t.name}</div>
              <div style={{fontSize:11,color:"var(--text-muted)",marginTop:2}}>
                <span style={{marginRight:8}}>{groupTypeLabel(n)}</span>
                <span style={{marginRight:8}}>{mids.map(id=>(state.wrestlers.find(x=>x.id===id)||{}).name||"?").join(", ")}</span>
              </div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:13,fontWeight:600}}><span style={{color:"var(--success)"}}>{rec2.wins}W</span> <span style={{color:"var(--error)"}}>{rec2.losses}L</span></div>
            </div>
          </div>);
        })}</>}
      {pastReigns.length>0&&<><div style={{fontFamily:"Teko,sans-serif",fontSize:16,fontWeight:600,textTransform:"uppercase",color:"var(--text-muted)",marginTop:12,marginBottom:8,borderBottom:"1px solid var(--border)",paddingBottom:4}}>Past Reigns</div>
        <div style={{maxHeight:200,overflowY:"auto"}}>
          {pastReigns.map(({c,h},i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:13}}>
            <i className="fas fa-trophy" style={{color:"var(--accent-dim)",fontSize:12,flexShrink:0}}/>
            <div><span style={{fontWeight:600,color:"var(--accent-dim)"}}>{c.name}</span><div style={{fontSize:11,color:"var(--text-muted)"}}>{fmtDate(h.wonDate)}{h.lostDate?" – "+fmtDate(h.lostDate):""} · {h.defenses} def.</div></div>
          </div>)}
        </div></>}
      <div style={{fontFamily:"Teko,sans-serif",fontSize:16,fontWeight:600,textTransform:"uppercase",color:"var(--text-muted)",marginTop:12,marginBottom:8,borderBottom:"1px solid var(--border)",paddingBottom:4}}>Match History {allMatches.length>0&&<span style={{fontFamily:"Outfit,sans-serif",fontSize:11,fontWeight:400}}>(Last {allMatches.length})</span>}</div>
      {allMatches.length?<div style={{maxHeight:200,overflowY:"auto"}}>
        {allMatches.map(m=>{
          const mWinnerIds=sa(m.winnerIds);const mWrestlers=sa(m.wrestlers);
          const isWin=mWinnerIds.includes(w.id);
          const mt=state.matchTypes.find(t=>t.id===m.matchType);
          let opp;
          if(mt?.isTag){
            const wOnWinningSide=mWinnerIds.includes(w.id);
            const sameTeam=mWrestlers.filter(id=>id!==w.id&&(mWinnerIds.includes(id)===wOnWinningSide));
            const oppIds=mWrestlers.filter(id=>id!==w.id&&!sameTeam.includes(id));
            opp=oppIds.map(id=>(state.wrestlers.find(x=>x.id===id)||{}).name||"?").join(", ")||"N/A";
          }else{
            opp=mWrestlers.filter(id=>id!==w.id).map(id=>(state.wrestlers.find(x=>x.id===id)||{}).name||"?").join(", ")||"N/A";
          }
          const mShow=state.shows.find(s=>s.id===m.showId);
          return(<div key={m.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:13}}>
            <div style={{width:24,height:24,borderRadius:"50%",background:isWin?"var(--success)":"var(--error)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,color:"#fff",flexShrink:0}}>{isWin?"W":"L"}</div>
            <div style={{flex:1,minWidth:0}}>
              <span style={{fontWeight:600,color:"var(--text)"}}>vs {opp}</span>
              <div style={{fontSize:11,color:"var(--text-muted)"}}>{mt?.name||m.matchType}{mShow?" · "+mShow.name:""} · {fmtDate(m.date)}{m.isChampionshipMatch?" · 🏆 "+(()=>{const ids=m.championshipIds&&m.championshipIds.length?m.championshipIds:(m.championshipId?[m.championshipId]:[]);return ids.map(cid=>(state.championships.find(c=>c.id===cid)||{}).name||"Title").join(" & ");})():"" }</div>
            </div>
          </div>);
        })}
      </div>:<p style={{color:"var(--text-muted)",fontStyle:"italic",fontSize:13}}>No matches recorded yet.</p>}
    </Modal>
  );
}

// ─── Championship Profile ─────────────────────────────────────────────────────
function ChampionshipProfile({c,state,onClose}){
  const isMITB=c.type==="mitb";const isTag=c.type==="tag";
  const accentColor=isMITB?"var(--success)":"var(--accent)";
  const show=state.shows.find(s=>s.id===c.showId);
  const holderName=c.currentHolderId?(isTag?(state.tagTeams.find(t=>t.id===c.currentHolderId)||{}).name:(state.wrestlers.find(w=>w.id===c.currentHolderId)||{}).name)||"?":"Vacant";
  const allReigns=[...sa(c.history)];
  if(c.currentHolderId)allReigns.push({holderId:c.currentHolderId,wonDate:c.wonDate,lostDate:null,defenses:c.defenses});
  let longestDays=0,longestHolder="";
  allReigns.forEach(r=>{
    const days=Math.max(1,Math.ceil((new Date(r.lostDate||new Date())-new Date(r.wonDate))/86400000));
    if(days>longestDays){longestDays=days;longestHolder=isTag?(state.tagTeams.find(t=>t.id===r.holderId)||{}).name||"?":(state.wrestlers.find(w=>w.id===r.holderId)||{}).name||"?";}
  });
  const currentDays=c.currentHolderId&&c.wonDate?Math.max(1,Math.ceil((new Date()-new Date(c.wonDate))/86400000)):0;
  const champMatches=state.matches.filter(m=>{
    if(!m.isChampionshipMatch)return false;
    if(m.championshipIds&&m.championshipIds.length)return m.championshipIds.includes(c.id);
    return m.championshipId===c.id;
  }).sort((a,b)=>{const d=new Date(b.date)-new Date(a.date);return d!==0?d:state.matches.indexOf(b)-state.matches.indexOf(a);}).slice(0,20);

  return(
    <Modal title={`${c.name} — Profile`} onClose={onClose} footer={<button className="btn btn-secondary" onClick={onClose}>Close</button>}>
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
        <div style={{width:80,height:80,borderRadius:8,overflow:"hidden",background:"var(--bg-input)",border:"2px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
          {c.image?<img src={c.image} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/>:<i className={`fas ${isMITB?"fa-briefcase":"fa-trophy"}`} style={{fontSize:32,color:"var(--text-muted)"}}/>}
        </div>
        <div>
          <div style={{fontFamily:"Teko,sans-serif",fontSize:28,fontWeight:700,textTransform:"uppercase",color:accentColor}}>{c.name}</div>
          <div style={{display:"flex",gap:6,marginTop:4,flexWrap:"wrap"}}>
            <span className="card-badge badge-show">{isMITB?"MITB":isTag?"Tag / Group":"Singles"}</span>
            {show&&<span className="card-badge badge-show"><span style={{width:8,height:8,borderRadius:"50%",background:show.color,display:"inline-block",marginRight:4}}/>{show.name}</span>}
          </div>
        </div>
      </div>
      <div style={{background:"var(--bg-input)",borderRadius:8,padding:"14px 16px",textAlign:"center",border:"1px solid var(--border)",marginBottom:14}}>
        <div style={{fontSize:11,textTransform:"uppercase",letterSpacing:1,color:"var(--text-muted)",marginBottom:4}}>{isMITB?"Briefcase Holder":"Current Champion"}</div>
        <div style={{fontFamily:"Teko,sans-serif",fontSize:26,fontWeight:700,textTransform:"uppercase",color:c.currentHolderId?accentColor:"var(--text-muted)"}}>{holderName}</div>
        {currentDays>0&&<div style={{fontSize:12,color:"var(--text-secondary)",marginTop:6}}>{!isMITB&&`${c.defenses} defense${c.defenses!==1?"s":""} · `}<i className="fas fa-calendar"/> {currentDays} day{currentDays!==1?"s":""}</div>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
        {[{v:allReigns.length,l:"Reigns"},{v:!isMITB?allReigns.reduce((s,r)=>s+(r.defenses||0),0):null,l:"Defenses"},{v:longestDays>0?longestDays+"d":"—",l:"Longest"},{v:champMatches.length,l:"Matches"}].filter(x=>x.v!==null).map(({v,l})=>(
          <div key={l} style={{background:"var(--bg-input)",borderRadius:6,padding:"10px 8px",textAlign:"center",border:"1px solid var(--border)"}}>
            <div style={{fontFamily:"Teko,sans-serif",fontSize:22,fontWeight:700,lineHeight:1,color:"var(--accent)"}}>{v}</div>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:"0.5px",color:"var(--text-muted)",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>
      {longestHolder&&<p style={{fontSize:12,color:"var(--text-muted)",textAlign:"center",marginBottom:14}}>Longest reign: {longestHolder} ({longestDays}d)</p>}
      <div style={{fontFamily:"Teko,sans-serif",fontSize:16,fontWeight:600,textTransform:"uppercase",color:"var(--text-muted)",marginBottom:8,borderBottom:"1px solid var(--border)",paddingBottom:4}}>{isMITB?"Briefcase History":"Title History"}</div>
      {allReigns.length?<div style={{maxHeight:220,overflowY:"auto"}}>
        {[...allReigns].reverse().map((h,idx)=>{
          const hName=isTag?(state.tagTeams.find(t=>t.id===h.holderId)||{}).name||"?":(state.wrestlers.find(w=>w.id===h.holderId)||{}).name||"?";
          const isCur=!h.lostDate&&c.currentHolderId===h.holderId;
          const days=Math.max(1,Math.ceil((new Date(h.lostDate||new Date())-new Date(h.wonDate))/86400000));
          return(<div key={idx} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"9px 10px",borderBottom:"1px solid var(--border)",background:isCur?"rgba(212,175,55,0.06)":"transparent"}}>
            <div style={{fontFamily:"Teko,sans-serif",fontSize:20,fontWeight:700,color:isCur?"var(--accent)":"var(--text-muted)",minWidth:24,textAlign:"center",lineHeight:1,paddingTop:2}}>{allReigns.length-idx}</div>
            <div style={{flex:1}}>
              <div style={{fontWeight:600,fontSize:14}}>{hName}{isCur&&<span style={{fontSize:10,fontWeight:700,textTransform:"uppercase",background:"var(--accent)",color:"#000",padding:"1px 6px",borderRadius:3,marginLeft:6}}>Current</span>}</div>
              <div style={{fontSize:12,color:"var(--text-muted)"}}>{fmtDate(h.wonDate)}{h.lostDate?" — "+fmtDate(h.lostDate):" — Present"} · {days}d{!isMITB?" · "+(h.defenses||0)+" def.":""}{h.vacated?<span style={{marginLeft:6,fontSize:11,fontWeight:700,color:"var(--error)",textTransform:"uppercase"}}>Vacated</span>:""}</div>
            </div>
          </div>);
        })}
      </div>:<p style={{color:"var(--text-muted)",fontStyle:"italic",fontSize:13}}>No title history yet.</p>}
      {champMatches.length>0&&<><div style={{fontFamily:"Teko,sans-serif",fontSize:16,fontWeight:600,textTransform:"uppercase",color:"var(--text-muted)",marginTop:16,marginBottom:8,borderBottom:"1px solid var(--border)",paddingBottom:4}}>Match History (Last {champMatches.length})</div>
        <div style={{maxHeight:220,overflowY:"auto"}}>
          {champMatches.map(m=>{
            const mShow=state.shows.find(s=>s.id===m.showId);
            const mt=state.matchTypes.find(t=>t.id===m.matchType);
            let display;
            if(mt?.isTag){
              const groupParts=(m.tagTeamIds||[]).map(tid=>({
                id:tid,name:(state.tagTeams.find(t=>t.id===tid)||{}).name||"?",isW:m.winnerTagTeamId===tid
              }));
              const adhocParts=(m.adhocTeams||[]).map(at=>({
                id:at.id,name:at.label,isW:m.winnerAdhocId===at.id
              }));
              const teamParts=[...groupParts,...adhocParts];
              display=teamParts.map((p,i)=><span key={p.id}>{i>0&&<span style={{fontSize:11,textTransform:"uppercase",color:"var(--text-muted)",margin:"0 4px"}}>vs</span>}<span style={{fontWeight:p.isW?700:400,color:p.isW?"var(--success)":"var(--text-secondary)"}}>{p.name}</span></span>);
            }else{
              const parts=sa(m.wrestlers).map(wid=>{const isW=sa(m.winnerIds).includes(wid);const name=(state.wrestlers.find(w=>w.id===wid)||{}).name||"?";return{wid,isW,name};});
              display=parts.map((p,i)=><span key={p.wid}>{i>0&&<span style={{fontSize:11,textTransform:"uppercase",color:"var(--text-muted)",margin:"0 4px"}}>vs</span>}<span style={{fontWeight:p.isW?700:400,color:p.isW?"var(--success)":"var(--text-secondary)"}}>{p.name}</span></span>);
            }
            return(<div key={m.id} style={{padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
              <div style={{fontSize:14}}>{display}</div>
              <div style={{fontSize:12,color:"var(--text-muted)",marginTop:2}}>{mt?.name||m.matchType}{mShow?" · "+mShow.name:""} · {fmtDate(m.date)}</div>
            </div>);
          })}
        </div></>}
    </Modal>
  );
}

// ─── Cloud Save Modal ────────────────────────────────────────────────────────
function CloudSaveModal({onClose,activeSlot,setActiveSlot,state,setState,setUnsaved,addToast,exportData,importRef,setConfirm,setEditMode,setView}){
  const [tab,setTab]=useState("save");
  const [localSaveName,setLocalSaveName]=useState(activeSlot||"");
  const [localSavePass,setLocalSavePass]=useState("");
  const [localEditPass,setLocalEditPass]=useState(state.editPassword||"");
  const [saveSlots,setSaveSlots]=useState([]);
  const [loading,setLoading]=useState(false);
  const [slotPasswords,setSlotPasswords]=useState({});
  const [overwritePending,setOverwritePending]=useState(null);
  const [backups,setBackups]=useState([]);
  const [backupsLoading,setBackupsLoading]=useState(false);

  const setSlotPass=(key,val)=>setSlotPasswords(p=>({...p,[key]:val}));

  const simpleHash=async(str)=>{
    if(!str)return"";
    try{
      const buf=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("").slice(0,16);
    }catch{return btoa(str).slice(0,16);}
  };

  const fetchSlots=async()=>{
    setLoading(true);
    try{
      const res=await storage.list("save:",true);
      const keys=res?.keys||[];
      const slots=[];
      for(const key of keys){
        try{
          const r=await storage.get(key,true);
          if(r){
            const m=JSON.parse(r.value);
            slots.push({key,name:m.name||key,savedAt:m.savedAt,hasPassword:!!m.passwordHash,
              wrestlers:m.wrestlers||0,shows:m.shows||0,matches:m.matches||0,championships:m.championships||0});
          }
        }catch{}
      }
      slots.sort((a,b)=>new Date(b.savedAt)-new Date(a.savedAt));
      setSaveSlots(slots);
    }catch{addToast("Couldn't load saves list","error");}
    setLoading(false);
  };

  const fetchBackups=async()=>{
    setBackupsLoading(true);
    try{
      const res=await storage.list("backup:",true);
      const keys=res?.keys||[];
      const list=[];
      for(const key of keys){
        try{
          const r=await storage.get(key,true);
          if(r){
            const snap=JSON.parse(r.value);
            list.push({
              key,
              saveName:snap.name||key,
              savedAt:snap.savedAt,
              wrestlers:snap.wrestlers||0,shows:snap.shows||0,matches:snap.matches||0,
              snapshot:snap
            });
          }
        }catch{}
      }
      list.sort((a,b)=>new Date(b.savedAt)-new Date(a.savedAt));
      setBackups(list);
    }catch{addToast("Couldn't load backups","error");}
    setBackupsLoading(false);
  };

  const restoreBackup=async(backup)=>{
    setBackupsLoading(true);
    try{
      const targetKey="save:"+backup.saveName.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-");
      // Snapshot whatever is currently live before restoring, so this is reversible too
      try{
        const current=await storage.get(targetKey,true);
        if(current){
          const backupKey="backup:"+targetKey+":"+Date.now();
          await storage.set(backupKey,current.value,true);
        }
      }catch{}
      await storage.set(targetKey,JSON.stringify(backup.snapshot),true);
      addToast(`Restored "${backup.saveName}" from backup!`,"success");
      await fetchSlots();
      await fetchBackups();
    }catch{addToast("Restore failed","error");}
    setBackupsLoading(false);
  };

  useEffect(()=>{fetchSlots();},[]);
  useEffect(()=>{if(tab==="recover")fetchBackups();},[tab]);

  const doSave=async(name,password,force=false)=>{
    if(!name.trim()){addToast("Enter a save name","error");return;}
    setLoading(true);
    const key="save:"+name.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-");
    let existing=null;
    try{const r=await storage.get(key,true);if(r)existing=JSON.parse(r.value);}catch{}
    if(existing&&!force){
      if(existing.passwordHash){
        const ph=await simpleHash(password);
        if(ph!==existing.passwordHash){setLoading(false);addToast("Wrong password — can't overwrite this save","error");return;}
      }
      setLoading(false);
      setOverwritePending({name:name.trim(),password,key});
      return;
    }
    // Safety net: if we're about to overwrite an existing save, snapshot the
    // old version first under a hidden backup key, so it can be recovered.
    if(existing&&force){
      try{
        const backupKey="backup:"+key+":"+Date.now();
        await storage.set(backupKey,JSON.stringify(existing),true);
      }catch{ /* backup failing shouldn't block the save itself */ }
    }
    const passwordHash=password?await simpleHash(password):(force&&existing?.passwordHash?existing.passwordHash:"");
    const stateToSave={...state,editPassword:localEditPass.trim()};
    const sizeEstimate=JSON.stringify(stateToSave).length;
    if(sizeEstimate>4500000){addToast("Save data too large — try removing some matches or images","error");setLoading(false);return;}
    const payload={
      name:name.trim(),savedAt:new Date().toISOString(),passwordHash,
      wrestlers:state.wrestlers.length,shows:state.shows.length,
      matches:state.matches.length,championships:state.championships.length,
      data:stateToSave
    };
    try{
      await storage.set(key,JSON.stringify(payload),true);
      setUnsaved(false);setActiveSlot(name.trim());
      addToast(`Saved as "${name.trim()}"!`,"success");
      await fetchSlots();
    }catch{addToast("Save failed — try a smaller dataset or shorter name","error");}
    setLoading(false);
  };

  const doLoad=async(slot,password="")=>{
    setLoading(true);
    try{
      const r=await storage.get(slot.key,true);
      if(!r){addToast("Save not found","error");setLoading(false);return;}
      let payload;
      try{payload=JSON.parse(r.value);}
      catch(e){addToast("Save data is corrupt — could not parse","error");setLoading(false);return;}
      if(payload.passwordHash){
        const ph=await simpleHash(password);
        if(ph!==payload.passwordHash){addToast("Wrong password","error");setLoading(false);return;}
      }
      const d=payload.data;
      if(!d||typeof d!=="object"){addToast("Save data is corrupt or unreadable","error");setLoading(false);return;}

      let safe;
      try{safe=sanitizeLoadedData(d);}
      catch(e){addToast("Could not load save: "+e.message,"error");setLoading(false);return;}

      // Close modal and reset view BEFORE setState to avoid render conflicts
      onClose();
      if(typeof setView==="function")setView("dashboard");
      if(typeof setEditMode==="function")setEditMode(false);
      // Small delay lets React flush the close/reset before the big state swap
      await new Promise(res=>setTimeout(res,80));
      setState(s=>({...s,...safe}));
      setUnsaved(false);
      setActiveSlot(payload.name);
      addToast(`Loaded "${payload.name}"!`,"success");
    }catch(e){
      // IMPORTANT: on any unexpected error, do NOT close the modal or touch state
      // Just show the error so the user can try again without a white screen
      addToast("Load failed — Supabase may be having issues, try again in a moment","error");
    }
    setLoading(false);
  };

  const doDelete=async(slot,password="")=>{
    setLoading(true);
    try{
      const r=await storage.get(slot.key,true);
      let payload=null;
      if(r){
        payload=JSON.parse(r.value);
        if(payload.passwordHash){
          const ph=await simpleHash(password);
          if(ph!==payload.passwordHash){addToast("Wrong password","error");setLoading(false);return;}
        }
      }
      // Safety net: back up before deleting, so it can be recovered
      if(payload){
        try{
          const backupKey="backup:"+slot.key+":"+Date.now();
          await storage.set(backupKey,JSON.stringify(payload),true);
        }catch{}
      }
      await storage.delete(slot.key,true);
      addToast("Save deleted (a backup was kept — see the Recover tab)","success");
      await fetchSlots();
    }catch{addToast("Delete failed","error");}
    setLoading(false);
  };

  if(overwritePending){
    return(
      <Modal title="Overwrite Save?" onClose={()=>setOverwritePending(null)} maxWidth={420}
        footer={<>
          <button className="btn btn-secondary" onClick={()=>setOverwritePending(null)}>Cancel</button>
          <button className="btn btn-primary" onClick={async()=>{const op=overwritePending;setOverwritePending(null);await doSave(op.name,op.password,true);}}>Yes, Overwrite</button>
        </>}>
        <p style={{color:"var(--text-secondary)",lineHeight:1.6}}>A save named <strong>"{overwritePending.name}"</strong> already exists. Overwrite it with your current data?</p>
      </Modal>
    );
  }

  return(
    <Modal title="Cloud Saves" onClose={onClose} maxWidth={560}>
      <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:"1px solid var(--border)",marginBottom:20}}>
        {[{id:"save",label:"Save",icon:"fa-cloud-arrow-up"},{id:"load",label:"Load",icon:"fa-cloud-arrow-down"},{id:"recover",label:"Recover",icon:"fa-clock-rotate-left"}].map(t=>(
          <button key={t.id} type="button" onClick={()=>setTab(t.id)}
            style={{flex:1,padding:"10px 10px",border:"none",background:tab===t.id?"var(--primary)":"var(--bg-input)",
              color:tab===t.id?"#fff":"var(--text-secondary)",fontFamily:"Teko,sans-serif",fontSize:15,fontWeight:600,
              textTransform:"uppercase",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
            <i className={`fas ${t.icon}`}/> {t.label}
          </button>
        ))}
      </div>

      {tab==="save"&&(
        <div>
          <div style={{padding:"8px 12px",background:"rgba(229,26,44,0.06)",border:"1px solid rgba(229,26,44,0.15)",borderRadius:6,marginBottom:12,fontSize:12,color:"var(--text-secondary)",lineHeight:1.5}}>
            <i className="fas fa-globe" style={{color:"var(--primary)",marginRight:5}}/>
            Saves are <strong style={{color:"var(--text)"}}>shared publicly</strong> — anyone with this app can browse and load them. Add a password to prevent others overwriting yours.
          </div>
          <div className="form-group">
            <label className="form-label">Save Name *</label>
            <input autoFocus className="form-input" value={localSaveName} onChange={e=>setLocalSaveName(e.target.value)}
              placeholder="e.g. MyUniverse, Johns-Playthrough..."/>
            <div style={{fontSize:11,color:"var(--text-muted)",marginTop:4}}>Letters, numbers and hyphens. Used as the unique ID.</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div className="form-group">
              <label className="form-label">Overwrite Password <span style={{color:"var(--text-muted)",fontWeight:400,textTransform:"none",fontSize:10}}>(stops others overwriting)</span></label>
              <input className="form-input" type="password" value={localSavePass} onChange={e=>setLocalSavePass(e.target.value)}
                placeholder="Leave blank for none"/>
            </div>
            <div className="form-group">
              <label className="form-label">Edit Password <span style={{color:"var(--text-muted)",fontWeight:400,textTransform:"none",fontSize:10}}>(unlocks editing for viewers)</span></label>
              <input className="form-input" type="password" value={localEditPass} onChange={e=>setLocalEditPass(e.target.value)}
                placeholder="Leave blank = anyone can edit"/>
            </div>
          </div>
          {localEditPass&&<div style={{padding:"8px 12px",background:"rgba(229,26,44,0.06)",border:"1px solid rgba(229,26,44,0.2)",borderRadius:6,marginBottom:12,fontSize:12,color:"var(--text-secondary)",lineHeight:1.5}}>
            <i className="fas fa-circle-info" style={{color:"var(--primary)",marginRight:5}}/>
            Make sure to tell your editors the edit password — it can only be recovered by loading and re-saving with a new one.
          </div>}
          <button className="btn btn-primary" style={{width:"100%",marginBottom:12}} disabled={loading}
            onClick={()=>doSave(localSaveName,localSavePass)}>
            {loading?<><i className="fas fa-spinner fa-spin"/> Saving...</>:<><i className="fas fa-cloud-arrow-up"/> Save to Cloud</>}
          </button>
          <div style={{borderTop:"1px solid var(--border)",paddingTop:12,display:"flex",gap:8,flexWrap:"wrap"}}>
            <button className="btn btn-secondary btn-sm" onClick={exportData}><i className="fas fa-download"/> Download JSON</button>
            <button className="btn btn-secondary btn-sm" onClick={()=>{onClose();setTimeout(()=>importRef.current.click(),100);}}>
              <i className="fas fa-upload"/> Load from File
            </button>
          </div>
        </div>
      )}

      {tab==="load"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <p style={{fontSize:13,color:"var(--text-muted)"}}>All cloud saves — click Load to restore any save.</p>
            <button className="btn btn-secondary btn-sm" onClick={fetchSlots} disabled={loading}>
              <i className="fas fa-rotate"/> Refresh
            </button>
          </div>
          {loading&&<div style={{textAlign:"center",padding:32,color:"var(--text-muted)"}}>
            <i className="fas fa-spinner fa-spin" style={{fontSize:28,display:"block",marginBottom:10}}/>Loading saves...
          </div>}
          {!loading&&saveSlots.length===0&&<div style={{textAlign:"center",padding:32,color:"var(--text-muted)"}}>
            <i className="fas fa-cloud" style={{fontSize:40,opacity:0.2,display:"block",marginBottom:10}}/>
            <p>No cloud saves yet. Switch to Save tab to create one!</p>
          </div>}
          {!loading&&saveSlots.length>0&&<div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:400,overflowY:"auto",paddingRight:2}}>
            {saveSlots.map(slot=>(
              <div key={slot.key} style={{background:"var(--bg-input)",borderRadius:8,border:"1px solid var(--border)",padding:"12px 14px"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                  <div style={{fontFamily:"Teko,sans-serif",fontSize:20,fontWeight:700,textTransform:"uppercase",lineHeight:1}}>
                    {slot.name}
                  </div>
                  {slot.hasPassword&&<i className="fas fa-lock" style={{fontSize:12,color:"var(--accent)"}} title="Password protected"/>}
                  {activeSlot===slot.name&&<span style={{fontSize:10,fontWeight:700,textTransform:"uppercase",padding:"2px 7px",borderRadius:20,background:"var(--success)",color:"#fff"}}>Active</span>}
                </div>
                <div style={{fontSize:11,color:"var(--text-muted)",marginBottom:8}}>
                  {fmtDate(slot.savedAt)}
                  {" · "}{slot.wrestlers} wrestlers
                  {" · "}{slot.shows} shows
                  {" · "}{slot.matches} matches
                  {" · "}{slot.championships} titles
                </div>
                {slot.hasPassword&&(
                  <input className="form-input" type="password" placeholder="Enter password..."
                    value={slotPasswords[slot.key]||""} onChange={e=>setSlotPass(slot.key,e.target.value)}
                    style={{marginBottom:8,fontSize:14,padding:"7px 10px"}}/>
                )}
                <div style={{display:"flex",gap:6}}>
                  <button className="btn btn-primary btn-sm" style={{flex:1}} disabled={loading}
                    onClick={()=>doLoad(slot,slotPasswords[slot.key]||"")}>
                    <i className="fas fa-cloud-arrow-down"/> Load
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={loading}
                    onClick={()=>setConfirm({
                      msg:`Delete save <strong>"${slot.name}"</strong>?${slot.hasPassword?" Enter the password in the field above first.":""}`,
                      fn:()=>doDelete(slot,slotPasswords[slot.key]||"")
                    })}>
                    <i className="fas fa-trash"/>
                  </button>
                </div>
              </div>
            ))}
          </div>}
        </div>
      )}

      {tab==="recover"&&(
        <div>
          <div style={{padding:"10px 14px",background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.2)",borderRadius:6,marginBottom:14,fontSize:13,color:"var(--text-secondary)",lineHeight:1.5}}>
            <i className="fas fa-shield-halved" style={{color:"var(--success)",marginRight:6}}/>
            Every time a save is overwritten, the previous version is automatically backed up here. If someone accidentally overwrote a save, find it below and restore it.
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <p style={{fontSize:13,color:"var(--text-muted)"}}>Backups by save name.</p>
            <button className="btn btn-secondary btn-sm" onClick={fetchBackups} disabled={backupsLoading}>
              <i className="fas fa-rotate"/> Refresh
            </button>
          </div>
          {backupsLoading&&<div style={{textAlign:"center",padding:32,color:"var(--text-muted)"}}>
            <i className="fas fa-spinner fa-spin" style={{fontSize:28,display:"block",marginBottom:10}}/>Loading backups...
          </div>}
          {!backupsLoading&&backups.length===0&&<div style={{textAlign:"center",padding:32,color:"var(--text-muted)"}}>
            <i className="fas fa-clock-rotate-left" style={{fontSize:40,opacity:0.2,display:"block",marginBottom:10}}/>
            <p>No backups yet — they appear here automatically whenever a save gets overwritten.</p>
          </div>}
          {!backupsLoading&&backups.length>0&&<div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:400,overflowY:"auto",paddingRight:2}}>
            {backups.map(b=>(
              <div key={b.key} style={{background:"var(--bg-input)",borderRadius:8,border:"1px solid var(--border)",padding:"12px 14px"}}>
                <div style={{fontFamily:"Teko,sans-serif",fontSize:18,fontWeight:700,textTransform:"uppercase",lineHeight:1,marginBottom:4}}>
                  {b.saveName}
                </div>
                <div style={{fontSize:11,color:"var(--text-muted)",marginBottom:8}}>
                  Backed up {fmtDate(b.savedAt)}
                  {" · "}{b.wrestlers} wrestlers
                  {" · "}{b.shows} shows
                  {" · "}{b.matches} matches
                </div>
                <button className="btn btn-primary btn-sm" style={{width:"100%"}} disabled={backupsLoading}
                  onClick={()=>setConfirm({
                    msg:`Restore this backup of <strong>"${b.saveName}"</strong>? This will overwrite the current "${b.saveName}" save with this older version.`,
                    fn:()=>restoreBackup(b)
                  })}>
                  <i className="fas fa-clock-rotate-left"/> Restore This Version
                </button>
              </div>
            ))}
          </div>}
        </div>
      )}
    </Modal>
  );
}

// ─── Error Boundary ───────────────────────────────────────────────────────────
// Catches any render crash (e.g. from corrupt/unexpected save data) and shows
// a friendly recovery screen instead of a blank white page.
class ErrorBoundary extends React.Component {
  constructor(props){super(props);this.state={crashed:false,error:"",stack:""};}
  static getDerivedStateFromError(e){return{crashed:true,error:e?.message||String(e),stack:e?.stack||""};}
  componentDidCatch(e,info){console.error("App crash:",e,info);}
  render(){
    if(this.state.crashed){
      return(
        <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#0B0B0F",color:"#F0F0F5",fontFamily:"Outfit,sans-serif",padding:24}}>
          <div style={{maxWidth:600,width:"100%"}}>
            <div style={{fontSize:48,marginBottom:16,textAlign:"center"}}>⚠️</div>
            <h2 style={{fontFamily:"Teko,sans-serif",fontSize:32,marginBottom:8,color:"#E51A2C",textAlign:"center"}}>Something went wrong</h2>
            <p style={{color:"#8A8AA0",marginBottom:12,lineHeight:1.6,textAlign:"center"}}>
              Copy everything in the box below and send it — this will tell us exactly what is broken.
            </p>
            <div style={{background:"#141419",border:"1px solid #2A2A38",borderRadius:8,padding:16,marginBottom:16,overflowX:"auto"}}>
              <div style={{color:"#EF4444",fontWeight:700,marginBottom:8,fontSize:14}}>Error:</div>
              <div style={{color:"#F0F0F5",fontSize:13,fontFamily:"monospace",marginBottom:12,whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{this.state.error}</div>
              {this.state.stack&&<>
                <div style={{color:"#8A8AA0",fontWeight:700,marginBottom:4,fontSize:12}}>Stack trace:</div>
                <div style={{color:"#55556A",fontSize:11,fontFamily:"monospace",whiteSpace:"pre-wrap",wordBreak:"break-all",maxHeight:200,overflowY:"auto"}}>{this.state.stack}</div>
              </>}
            </div>
            <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
              <button onClick={()=>window.location.reload()}
                style={{padding:"10px 24px",background:"#E51A2C",color:"#fff",border:"none",borderRadius:6,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"Outfit,sans-serif"}}>
                🔄 Reload App
              </button>
              <button onClick={()=>this.setState({crashed:false,error:"",stack:""})}
                style={{padding:"10px 24px",background:"transparent",color:"#8A8AA0",border:"1px solid #2A2A38",borderRadius:6,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"Outfit,sans-serif"}}>
                Try Again
              </button>
            </div>
            <p style={{color:"#55556A",fontSize:12,marginTop:20,textAlign:"center"}}>
              Your data in Supabase is safe — the crash only affects the display.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Edit Mode Password Modal ─────────────────────────────────────────────────
function EditPasswordModal({onUnlock,onClose,editPassword}){
  const [input,setInput]=useState("");
  const [error,setError]=useState(false);
  const attempt=()=>{
    if(!editPassword||input.trim()===editPassword.trim()){onUnlock();onClose();}
    else{setError(true);setInput("");}
  };
  return(
    <Modal title="Enter Edit Password" onClose={onClose} maxWidth={380}
      footer={<><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={attempt}><i className="fas fa-unlock"/> Unlock</button></>}>
      <p style={{fontSize:14,color:"var(--text-secondary)",marginBottom:16,lineHeight:1.5}}>
        This tracker is in <strong>view-only mode</strong>. Enter the edit password to add, edit, or delete anything.
      </p>
      {!editPassword&&<div style={{padding:"8px 12px",background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.2)",borderRadius:6,marginBottom:12,fontSize:13,color:"var(--success)"}}>
        <i className="fas fa-circle-info"/> No edit password set on this save — click Unlock to proceed.
      </div>}
      {editPassword&&<div className="form-group">
        <label className="form-label">Password</label>
        <input autoFocus className="form-input" type="password" value={input}
          onChange={e=>{setInput(e.target.value);setError(false);}}
          onKeyDown={e=>{if(e.key==="Enter")attempt();}}
          placeholder="Enter password..."
          style={{borderColor:error?"var(--error)":undefined}}/>
        {error&&<div className="form-hint" style={{color:"var(--error)",marginTop:6}}><i className="fas fa-circle-xmark"/> Incorrect password — try again.</div>}
      </div>}
    </Modal>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
function App(){
  // Only inject fonts/icons if index.html hasn't already loaded them (e.g. when used as a standalone artifact)
  useExternalCSS("https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css");
  useExternalCSS("https://fonts.googleapis.com/css2?family=Teko:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap");
  const [state,setState]=useState(INIT_STATE);
  const [view,setView]=useState("dashboard");
  const [modal,setModal]=useState(null);// {type, data}
  const [confirm,setConfirm]=useState(null);
  const [unsaved,setUnsaved]=useState(false);
  const [editMode,setEditMode]=useState(false);
  const [editPasswordModal,setEditPasswordModal]=useState(false);
  const [toasts,addToast]=useToasts();
  const [rosterSearch,setRosterSearch]=useState("");
  const [rosterShowFilter,setRosterShowFilter]=useState("");
  const [matchSearch,setMatchSearch]=useState("");
  const [matchShowFilter,setMatchShowFilter]=useState("");
  const [tagSearch,setTagSearch]=useState("");
  const [gtFilter,setGtFilter]=useState("");
  const [showTypeFilter,setShowTypeFilter]=useState("");
  const [profileModal,setProfileModal]=useState(null);// {type:"wrestler"|"championship", data}

  const mutate=(fn)=>{setState(s=>{const ns={...s};fn(ns);return ns;});setUnsaved(true);};

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const wName=(id)=>(state.wrestlers.find(w=>w.id===id)||{}).name||"Unknown";
  const tName=(id)=>(state.tagTeams.find(t=>t.id===id)||{}).name||"Unknown";

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  const saveWrestler=(id,data)=>{
    mutate(s=>{
      if(id){const w=s.wrestlers.find(x=>x.id===id);if(w)Object.assign(w,data);}
      else s.wrestlers.push({id:uid(),...data,createdAt:new Date().toISOString()});
    });
    addToast(id?"Wrestler updated":"Wrestler added","success");
  };
  const deleteWrestler=(id)=>{
    mutate(s=>{
      s.wrestlers=s.wrestlers.filter(x=>x.id!==id);
      const removedTeamIds=new Set();
      s.tagTeams=s.tagTeams.filter(t=>{
        const mids=t.memberIds&&t.memberIds.length?t.memberIds:[t.member1Id,t.member2Id].filter(Boolean);
        const hasIt=mids.includes(id);
        if(hasIt)removedTeamIds.add(t.id);
        return !hasIt;
      });
      s.championships.forEach(c=>{
        if(c.type==="singles"&&c.currentHolderId===id){
          if(c.currentHolderId)c.history.push({holderId:c.currentHolderId,wonDate:c.wonDate,lostDate:new Date().toISOString(),defenses:c.defenses});
          c.currentHolderId=null;c.defenses=0;c.wonDate=null;
        }
        if(c.type==="tag"&&removedTeamIds.has(c.currentHolderId)){
          c.history.push({holderId:c.currentHolderId,wonDate:c.wonDate,lostDate:new Date().toISOString(),defenses:c.defenses});
          c.currentHolderId=null;c.defenses=0;c.wonDate=null;
        }
        // Also clean up holders in title history that reference the removed team(s) — leave history intact for record-keeping
      });
    });
    addToast("Wrestler deleted","success");
  };
  const saveShow=(id,data)=>{
    mutate(s=>{
      if(id){const sh=s.shows.find(x=>x.id===id);if(sh)Object.assign(sh,data);}
      else s.shows.push({id:uid(),...data});
    });
    addToast(id?"Show updated":"Show added","success");
  };
  const deleteShow=(id)=>{
    mutate(s=>{
      s.shows=s.shows.filter(x=>x.id!==id);
      s.wrestlers.forEach(w=>{if(w.showId===id)w.showId="";});
      s.championships.forEach(c=>{if(c.showId===id)c.showId="";});
      s.shows.forEach(sh=>{if(sh.linkedShows)sh.linkedShows=sh.linkedShows.filter(lid=>lid!==id);});
    });
    addToast("Show deleted","success");
  };
  const saveTagTeam=(id,data)=>{
    mutate(s=>{
      if(id){const t=s.tagTeams.find(x=>x.id===id);if(t)Object.assign(t,data);}
      else s.tagTeams.push({id:uid(),...data});
    });
    const size=(data.memberIds||[]).filter(Boolean).length;
    addToast(id?`${groupTypeLabel(size)} updated`:`${groupTypeLabel(size)} added`,"success");
  };
  const deleteTagTeam=(id)=>{
    mutate(s=>{
      s.tagTeams=s.tagTeams.filter(x=>x.id!==id);
      s.championships.forEach(c=>{if(c.type==="tag"&&c.currentHolderId===id){if(c.currentHolderId)c.history.push({holderId:c.currentHolderId,wonDate:c.wonDate,lostDate:new Date().toISOString(),defenses:c.defenses});c.currentHolderId=null;c.defenses=0;c.wonDate=null;}});
    });
    addToast("Tag team deleted","success");
  };
  const saveChampionship=(id,{name,type,showId,holderId,image})=>{
    mutate(s=>{
      if(id){
        const c=s.championships.find(x=>x.id===id);
        if(c){
          c.name=name;c.showId=showId;c.image=image||"";
          if(c.type!==type){c.type=type;c.currentHolderId=holderId||null;c.defenses=0;c.wonDate=holderId?new Date().toISOString():null;c.history=[];}
          else if(c.currentHolderId!==holderId){
            if(c.currentHolderId)c.history.push({holderId:c.currentHolderId,wonDate:c.wonDate,lostDate:new Date().toISOString(),defenses:c.defenses});
            c.currentHolderId=holderId||null;c.defenses=0;c.wonDate=holderId?new Date().toISOString():null;
          }
        }
      }else{
        s.championships.push({id:uid(),name,type,showId,image:image||"",currentHolderId:holderId||null,defenses:0,wonDate:holderId?new Date().toISOString():null,history:[]});
      }
    });
    addToast(id?"Championship updated":"Championship added","success");
  };
  const deleteChampionship=(id)=>{mutate(s=>{s.championships=s.championships.filter(x=>x.id!==id);});addToast("Championship deleted","success");};
  const vacateChampionship=(id)=>{
    mutate(s=>{
      const c=s.championships.find(x=>x.id===id);
      if(!c||!c.currentHolderId)return;
      // Push current reign into history before vacating
      c.history.push({
        holderId:c.currentHolderId,
        wonDate:c.wonDate,
        lostDate:new Date().toISOString(),
        defenses:c.defenses,
        vacated:true,
      });
      c.currentHolderId=null;
      c.defenses=0;
      c.wonDate=null;
    });
    addToast("Championship vacated","success");
  };
  
  const saveMatch=(id,data)=>{
    mutate(s=>{
      // Handle championship logic — ONLY for brand-new matches.
      let titleChanged=false,titleChangedFrom="",titleChangedTo="";
      if(!id&&data.isChampionshipMatch){
        // Support both old single championshipId and new array
        const ids=data.championshipIds&&data.championshipIds.length?data.championshipIds:(data.championshipId?[data.championshipId]:[]);
        const mt=s.matchTypes.find(t=>t.id===data.matchType);
        const isTagMatch=mt?.isTag;
        const titleChanges=[]; // collect all changes to display
        ids.forEach(cid=>{
          const champ=s.championships.find(c=>c.id===cid);
          if(!champ)return;
          if(champ.type==="mitb"){
            const nw=data.winnerIds[0];
            if(champ.currentHolderId&&champ.currentHolderId!==nw){
              titleChanges.push({from:(s.wrestlers.find(w=>w.id===champ.currentHolderId)||{}).name||"?",to:(s.wrestlers.find(w=>w.id===nw)||{}).name||"?",name:champ.name});
              champ.history.push({holderId:champ.currentHolderId,wonDate:champ.wonDate,lostDate:data.date,defenses:0});
              champ.currentHolderId=nw;champ.wonDate=data.date;
            }else if(!champ.currentHolderId){
              titleChanges.push({from:"",to:(s.wrestlers.find(w=>w.id===nw)||{}).name||"?",name:champ.name});
              champ.currentHolderId=nw;champ.wonDate=data.date;
            }
            champ.defenses=0;
          }else{
            const currentH=champ.currentHolderId;
            if(isTagMatch&&data.winnerAdhocId&&!data.winnerTagTeamId){
              // Skip — ad-hoc teams can't hold titles
            }else{
              const newW=isTagMatch?data.winnerTagTeamId:data.winnerIds[0];
              const newWName=isTagMatch?(s.tagTeams.find(t=>t.id===newW)||{}).name||"?":(s.wrestlers.find(w=>w.id===newW)||{}).name||"?";
              if(currentH){
                if(currentH===newW){champ.defenses++;}
                else{
                  titleChanges.push({from:isTagMatch?(s.tagTeams.find(t=>t.id===currentH)||{}).name||"?":(s.wrestlers.find(w=>w.id===currentH)||{}).name||"?",to:newWName,name:champ.name});
                  champ.history.push({holderId:currentH,wonDate:champ.wonDate,lostDate:data.date,defenses:champ.defenses});
                  champ.currentHolderId=newW;champ.defenses=0;champ.wonDate=data.date;
                }
              }else{
                titleChanges.push({from:"",to:newWName,name:champ.name});
                champ.currentHolderId=newW;champ.defenses=0;champ.wonDate=data.date;
              }
            }
          }
        });
        // Build titleChanged summary from all championships
        if(titleChanges.length>0){
          titleChanged=true;
          titleChangedFrom=titleChanges.filter(t=>t.from).map(t=>t.from).join(" & ")||"";
          titleChangedTo=titleChanges.map(t=>t.to).join(" & ");
        }
      }
      if(id){
        const idx=s.matches.findIndex(m=>m.id===id);
        if(idx>=0){
          const existing=s.matches[idx];
          // Preserve the original titleChanged/From/To since those were computed when the match was first created
          s.matches[idx]={...existing,...data,titleChanged:existing.titleChanged,titleChangedFrom:existing.titleChangedFrom,titleChangedTo:existing.titleChangedTo};
        }
      }else{
        s.matches.push({id:uid(),...data,titleChanged,titleChangedFrom,titleChangedTo});
      }
    });
    addToast(id?"Match updated":"Match recorded","success");
  };
  const deleteMatch=(id)=>{mutate(s=>{s.matches=s.matches.filter(x=>x.id!==id);});addToast("Match deleted","success");};

  const executeCashIn=(mitbId,targetId,result,cashDate)=>{
    mutate(s=>{
      const mitb=s.championships.find(c=>c.id===mitbId);if(!mitb)return;
      const target=s.championships.find(c=>c.id===targetId);if(!target)return;
      const cashInHolder=mitb.currentHolderId;
      const defendingChamp=target.currentHolderId;
      mitb.history.push({holderId:cashInHolder,wonDate:mitb.wonDate,lostDate:cashDate,defenses:0,cashedIn:true});
      mitb.currentHolderId=null;mitb.defenses=0;mitb.wonDate=null;
      const matchWrestlers=[cashInHolder];
      if(defendingChamp&&defendingChamp!==cashInHolder)matchWrestlers.push(defendingChamp);
      const winnerIds=result==="won"?[cashInHolder]:defendingChamp?[defendingChamp]:[cashInHolder];
      if(result==="won"){
        if(defendingChamp)target.history.push({holderId:defendingChamp,wonDate:target.wonDate,lostDate:cashDate,defenses:target.defenses});
        target.currentHolderId=cashInHolder;target.defenses=0;target.wonDate=cashDate;
      }
      s.matches.push({id:uid(),date:cashDate,showId:"",matchType:"singles",wrestlers:matchWrestlers,tagTeamIds:[],winnerIds,winnerTagTeamId:null,isChampionshipMatch:true,championshipId:targetId,notes:"MITB Cash In ("+mitb.name+") — "+(result==="won"?"Successful":"Failed"),titleChanged:result==="won",titleChangedFrom:result==="won"&&defendingChamp?(s.wrestlers.find(w=>w.id===defendingChamp)||{}).name||"":"",titleChangedTo:result==="won"?(s.wrestlers.find(w=>w.id===cashInHolder)||{}).name||"":""});
    });
    addToast(result==="won"?"Cashed in successfully! New champion crowned!":"Cash in failed!",result==="won"?"success":"error");
  };

  const saveMatchType=(id,data)=>{
    mutate(s=>{
      if(id){const t=s.matchTypes.find(x=>x.id===id);if(t)Object.assign(t,data);}
      else s.matchTypes.push({id:uid(),...data,isDefault:false});
    });
    addToast(id?"Match type updated":"Match type added","success");
  };
  const deleteMatchType=(id)=>{
    mutate(s=>{s.matchTypes=s.matchTypes.filter(x=>x.id!==id);});
    addToast("Match type deleted","success");
  };

  // ── Cloud Save / Load ────────────────────────────────────────────────────────
  const [cloudModal,setCloudModal]=useState(false);
  const [activeSlot,setActiveSlot]=useState(null);

  // Local file export/import kept as backup
  const exportData=()=>{
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="wwe2k26-tracker-"+new Date().toISOString().slice(0,10)+".json";
    document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
    setUnsaved(false);addToast("Downloaded as JSON backup","success");
  };
  const importRef=useRef();
  const importData=(e)=>{
    const file=e.target.files[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      try{const data=JSON.parse(ev.target.result);
        const safe=sanitizeLoadedData(data);
        setState(s=>({...s,...safe}));
        setUnsaved(false);addToast("Data loaded from file!","success");
      }catch{addToast("Invalid file","error");}
    };
    reader.readAsText(file);e.target.value="";
  };

  // ── Cloud Save Modal ─────────────────────────────────────────────────────────
  // (defined outside App — see CloudSaveModal component above)


  // ── Match card render ────────────────────────────────────────────────────────
  const MatchCard=({m,editMode})=>{
    const show=state.shows.find(s=>s.id===m.showId);
    const mt=state.matchTypes.find(t=>t.id===m.matchType)||{name:m.matchType,isTag:false};
    const isTitle=m.isChampionshipMatch;
    // Support both old single championshipId and new array
    const champIds=m.championshipIds&&m.championshipIds.length?m.championshipIds:(m.championshipId?[m.championshipId]:[]);
    const champs=isTitle?champIds.map(cid=>state.championships.find(c=>c.id===cid)).filter(Boolean):[];
    const groupParticipants=(m.tagTeamIds||[]).map(tid=>{
      const t=state.tagTeams.find(x=>x.id===tid);
      const fullMids=t?getGroupMembers(t):[];
      // Use active members if stored, otherwise fall back to full roster
      const activeMids=(m.slotActiveMembers&&m.slotActiveMembers[tid]&&m.slotActiveMembers[tid].length>0)
        ?m.slotActiveMembers[tid]
        :fullMids;
      const benchedMids=fullMids.filter(mid=>!activeMids.includes(mid));
      return {
        id:tid,
        name:tName(tid),
        isWinner:m.winnerTagTeamId===tid,
        memberNames:activeMids.map(mid=>wName(mid)),
        benchedNames:benchedMids.map(mid=>wName(mid)),
        isAdhoc:false
      };
    });
    const adhocParticipants=(m.adhocTeams||[]).map(at=>({
      id:at.id,name:at.label,isWinner:m.winnerAdhocId===at.id,
      memberNames:(at.memberIds||[]).map(mid=>wName(mid)),
      benchedNames:[],isAdhoc:true
    }));
    const participants=mt.isTag?[...groupParticipants,...adhocParticipants]
      :sa(m.wrestlers).map(wid=>({id:wid,name:wName(wid),isWinner:sa(m.winnerIds).includes(wid)}));
    const winnerDisplay=mt.isTag
      ?(m.winnerTagTeamId?tName(m.winnerTagTeamId):(sa(m.adhocTeams)).find(a=>a.id===m.winnerAdhocId)?.label)||"?"
      :sa(m.winnerIds).map(id=>wName(id)).join(" & ");
    return(
      <div className="match-card" style={{borderLeft:m.titleChanged&&isTitle?"3px solid var(--accent)":""}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8,flexWrap:"wrap",gap:6}}>
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text-muted)"}}>
            {show&&<span className="card-badge badge-show"><span style={{width:8,height:8,borderRadius:"50%",background:show.color,display:"inline-block"}}/> {show.name}</span>}
            <span>{fmtDate(m.date)}</span>
          </div>
          <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap"}}>
            {isTitle&&champs.length>0
              ? champs.map(c=>(
                  <span key={c.id} className="match-type-badge championship">
                    <i className="fas fa-trophy"/> {c.name}
                  </span>
                ))
              : isTitle
                ? <span className="match-type-badge championship"><i className="fas fa-trophy"/> Title</span>
                : <span className="match-type-badge">{mt.name}</span>
            }
            {editMode&&<><button className="card-action-btn" onClick={()=>setModal({type:"match",data:m})}><i className="fas fa-pen"/></button>
            <button className="card-action-btn delete" onClick={()=>setConfirm({msg:"Delete this match?",fn:()=>deleteMatch(m.id)})}><i className="fas fa-trash"/></button></>}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",fontFamily:"Teko,sans-serif",fontSize:19,fontWeight:500,textTransform:"uppercase"}}>
          {participants.map((p,i)=><span key={p.id}>{i>0&&<span style={{color:"var(--text-muted)",fontSize:13,fontFamily:"Outfit,sans-serif",fontWeight:600}}> vs </span>}<span style={{color:p.isWinner?"var(--success)":"var(--text-secondary)"}}>{p.name}</span>{p.isAdhoc&&<i className="fas fa-link-slash" style={{fontSize:10,marginLeft:4,opacity:0.5}} title="Ad-hoc team"/>}</span>)}
        </div>
        {mt.isTag&&participants.some(p=>p.memberNames&&p.memberNames.length>0)&&(
          <div style={{marginTop:4,display:"flex",flexWrap:"wrap",gap:10,fontSize:11,color:"var(--text-muted)"}}>
            {participants.map(p=>p.memberNames&&p.memberNames.length>0?(
              <span key={p.id}>
                <span style={{fontWeight:600,color:p.isWinner?"var(--success)":"var(--text-secondary)"}}>{p.name}:</span>{" "}
                {p.memberNames.join(", ")}
                {p.benchedNames&&p.benchedNames.length>0&&(
                  <span style={{opacity:0.45,fontStyle:"italic"}}>{" "}(+{p.benchedNames.join(", ")} not competing)</span>
                )}
              </span>
            ):null)}
          </div>
        )}
        <div style={{marginTop:6,fontSize:12,color:"var(--text-muted)"}}>
          <span style={{color:"var(--success)",fontWeight:600}}><i className="fas fa-hand-fist"/> Winner:</span> {winnerDisplay}
          {m.notes&&<span> — <span style={{fontStyle:"italic"}}>{m.notes}</span></span>}
        </div>
        {m.titleChanged&&isTitle&&<div style={{marginTop:8,padding:"6px 10px",background:"linear-gradient(90deg,rgba(212,175,55,0.12),transparent)",borderRadius:6,fontSize:12,color:"var(--accent)",fontWeight:500}}>
          <i className="fas fa-repeat"/> {m.titleChangedFrom?<><strong>NEW {(champs[0]?.name||"CHAMPIONSHIP").toUpperCase()}!</strong> {m.titleChangedTo} defeats {m.titleChangedFrom}</>:<><strong>{m.titleChangedTo}</strong> wins the vacant {champs[0]?.name||"championship"}</>}
        </div>}
      </div>
    );
  };

  // ── Views ────────────────────────────────────────────────────────────────────
  const ranked=[...state.wrestlers].sort((a,b)=>getPowerRating(b.id,state)-getPowerRating(a.id,state));

  const Dashboard=({editMode})=>{
    const recentMatches=[...state.matches].sort((a,b)=>{const d=new Date(b.date)-new Date(a.date);return d!==0?d:state.matches.indexOf(b)-state.matches.indexOf(a);}).slice(0,5);
    const top5=ranked.slice(0,5);
    const champCards=state.championships.filter(c=>c.type!=="mitb");
    const mitbCards=state.championships.filter(c=>c.type==="mitb");
    return(
      <div>
        <div className="section-header"><div className="section-title">Dashboard</div></div>
        <div className="stats-row">
          {[{v:state.wrestlers.length,l:"Wrestlers",cls:"primary"},{v:state.shows.length,l:"Shows",cls:""},{v:state.tagTeams.length,l:"Groups",cls:""},{v:state.championships.length,l:"Titles",cls:"gold"},{v:state.matches.length,l:"Matches",cls:"green"}].map(({v,l,cls})=>(
            <div key={l} className={`stat-card ${cls}`}><div className="stat-value">{v}</div><div className="stat-label">{l}</div></div>
          ))}
        </div>
        {champCards.length>0&&<div className="dash-section">
          <div className="dash-section-title"><i className="fas fa-trophy"/> Champions</div>
          <div className="champions-grid">
            {champCards.map(c=>{
              const holderName=c.currentHolderId?(c.type==="tag"?tName(c.currentHolderId):wName(c.currentHolderId)):"Vacant";
              return(<div key={c.id} className="champion-card" style={{cursor:"pointer"}} onClick={()=>setProfileModal({type:"championship",data:c})}>
                <div className="champion-card-top">
                  <div style={{width:36,height:36,borderRadius:6,overflow:"hidden",background:"var(--bg-input)",border:"2px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {c.image?<img src={c.image} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/>:<i className="fas fa-trophy" style={{color:"var(--accent)",fontSize:14}}/>}
                  </div>
                  <div className="champion-info">
                    <div className="champion-belt"><i className="fas fa-trophy"/> {c.name}</div>
                    <div className="champion-name">{c.currentHolderId?holderName:<span className="champion-vacant">Vacant</span>}</div>
                  </div>
                </div>
                {c.currentHolderId&&<div className="champion-card-bottom"><div className="champion-defenses"><i className="fas fa-shield-halved"/> <span className="champion-defenses-count">{c.defenses}</span> defense{c.defenses!==1?"s":""}</div></div>}
              </div>);
            })}
          </div>
        </div>}
        {mitbCards.length>0&&<div className="dash-section">
          <div className="dash-section-title"><i className="fas fa-briefcase" style={{color:"var(--success)"}}/> Money in the Bank</div>
          <div className="champions-grid">
            {mitbCards.map(c=>{
              const holderName=c.currentHolderId?wName(c.currentHolderId):"Unclaimed";
              return(<div key={c.id} className="champion-card" style={{borderColor:"rgba(34,197,94,0.25)",cursor:"pointer"}} onClick={()=>setProfileModal({type:"championship",data:c})}>
                <div className="champion-card-top">
                  <div className="champion-info">
                    <div className="champion-belt" style={{color:"var(--success)"}}><i className="fas fa-briefcase"/> {c.name}</div>
                    <div className="champion-name">{c.currentHolderId?holderName:<span className="champion-vacant" style={{color:"var(--text-muted)"}}>Unclaimed</span>}</div>
                  </div>
                </div>
              </div>);
            })}
          </div>
        </div>}
        {top5.length>0&&<div className="dash-section">
          <div className="dash-section-title"><i className="fas fa-ranking-star"/> Top 5 Power Rankings</div>
          <div className="ranking-list">
            {top5.map((w,i)=>{const rec=getRecord(w.id,state.matches);const rating=getPowerRating(w.id,state);const champs=getCurrentChampionships(w.id,state.championships);
              return(<div key={w.id} className="ranking-item" style={{cursor:"pointer"}} onClick={()=>setProfileModal({type:"wrestler",data:w})}>
                <div className="rank-number">{i+1}</div>
                <div className="rank-info">
                  <div className="rank-name">{w.name}{champs.map(c=><i key={c.id} className="fas fa-trophy rank-champ-icon" title={c.name}/>)}</div>
                  <div className="rank-stats"><span className="badge-win">{rec.wins}W</span> <span className="badge-loss">{rec.losses}L</span> <span>{Math.round(rec.pct*100)}%</span></div>
                </div>
                <div className="rank-rating"><div className="rating-value">{rating}</div><div className="rating-label">PWR</div></div>
              </div>);
            })}
          </div>
        </div>}
        {recentMatches.length>0&&<div className="dash-section">
          <div className="dash-section-title"><i className="fas fa-bolt"/> Recent Matches</div>
          <div className="match-list">{recentMatches.map(m=><MatchCard key={m.id} m={m} editMode={editMode}/>)}</div>
        </div>}
        {!state.wrestlers.length&&!state.matches.length&&<div className="empty-state"><i className="fas fa-dumbbell"/><p>Welcome to your WWE 2K26 Tracker!<br/>{editMode?"Start by adding shows and wrestlers.":"Unlock editing to start adding data."}</p>{editMode&&<button className="btn btn-primary" onClick={()=>setView("shows")}><i className="fas fa-plus"/> Add Your First Show</button>}</div>}
      </div>
    );
  };

  const Roster=({editMode})=>{
    const weekly=state.shows.filter(s=>(s.showType||"weekly")==="weekly");
    const list=state.wrestlers.filter(w=>{
      if(rosterSearch&&!w.name.toLowerCase().includes(rosterSearch.toLowerCase())&&!(w.nickname||"").toLowerCase().includes(rosterSearch.toLowerCase()))return false;
      if(rosterShowFilter&&w.showId!==rosterShowFilter)return false;
      return true;
    });
    return(
      <div>
        <div className="section-header"><div className="section-title">Roster <span className="count">({state.wrestlers.length})</span></div>{editMode&&<button className="btn btn-primary" onClick={()=>setModal({type:"wrestler",data:null})}><i className="fas fa-plus"/> Add Wrestler</button>}</div>
        <div className="filter-bar">
          <div className="search-box"><i className="fas fa-search"/><input type="text" placeholder="Search wrestlers..." value={rosterSearch} onChange={e=>setRosterSearch(e.target.value)}/></div>
          <select className="filter-select" value={rosterShowFilter} onChange={e=>setRosterShowFilter(e.target.value)}>
            <option value="">All Shows</option>
            {weekly.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {list.length?<div className="card-grid">
          {list.map(w=>{
            const rec=getRecord(w.id,state.matches);const champs=getCurrentChampionships(w.id,state.championships);
            const show=state.shows.find(s=>s.id===w.showId);const winPct=rec.total>0?Math.round(rec.pct*100):0;
            return(<div key={w.id} className="card" style={{cursor:"pointer"}} onClick={e=>{if(!e.target.closest(".card-actions"))setProfileModal({type:"wrestler",data:w});}}>
              <div className="card-header">
                <div style={{display:"flex",gap:10,alignItems:"center",minWidth:0}}>
                  <div className="card-avatar">{w.image?<img src={w.image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span className="card-avatar-placeholder"><i className="fas fa-user"/></span>}</div>
                  <div style={{minWidth:0}}><div className="card-name">{w.name}</div>{w.nickname&&<div className="card-nickname">"{w.nickname}"</div>}</div>
                </div>
                {editMode&&<div className="card-actions">
                  <button onClick={e=>{e.stopPropagation();setModal({type:"wrestler",data:w});}}><i className="fas fa-pen"/></button>
                  <button className="delete-btn" onClick={e=>{e.stopPropagation();setConfirm({msg:`Delete <strong>${w.name}</strong>?`,fn:()=>deleteWrestler(w.id)});}}><i className="fas fa-trash"/></button>
                </div>}
              </div>
              {show&&<div className="card-stat"><span style={{width:10,height:10,borderRadius:"50%",background:show.color,display:"inline-block"}}/> {show.name}</div>}
              <div className="win-loss"><span className="wins">{rec.wins}W</span><span className="losses">{rec.losses}L</span><span style={{color:"var(--text-muted)"}}>{winPct}%</span></div>
              <div className="record-bar"><div className="win-bar" style={{width:(rec.total>0?rec.wins/rec.total*100:0)+"%"}}/><div className="loss-bar" style={{width:(rec.total>0?rec.losses/rec.total*100:0)+"%"}}/></div>
              {champs.length>0&&<div style={{marginTop:8}}>{champs.map(c=><span key={c.id} className="card-badge badge-champion"><i className="fas fa-trophy"/> {c.name}</span>)}</div>}
            </div>);
          })}
        </div>:<div className="empty-state"><i className="fas fa-user-plus"/><p>No wrestlers found.</p></div>}
      </div>
    );
  };

  const Shows=({editMode})=>{
    let list=[...state.shows];
    if(showTypeFilter)list=list.filter(s=>(s.showType||"weekly")===showTypeFilter);
    list.sort((a,b)=>{const aP=(a.showType||"weekly")==="ple"?1:0;const bP=(b.showType||"weekly")==="ple"?1:0;if(aP!==bP)return bP-aP;if(aP&&bP&&a.pleDate&&b.pleDate)return new Date(b.pleDate)-new Date(a.pleDate);return 0;});
    const wCount=state.shows.filter(s=>(s.showType||"weekly")==="weekly").length;
    const pCount=state.shows.filter(s=>s.showType==="ple").length;
    return(
      <div>
        <div className="section-header"><div className="section-title">Shows <span className="count">({state.shows.length})</span></div>{editMode&&<button className="btn btn-primary" onClick={()=>setModal({type:"show",data:null})}><i className="fas fa-plus"/> Add Show / PLE</button>}</div>
        <div className="filter-bar">
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {[{v:"",l:`All (${state.shows.length})`},{v:"weekly",l:`Weekly (${wCount})`},{v:"ple",l:`PLEs (${pCount})`}].map(({v,l})=>(
              <div key={v} className={`chip${showTypeFilter===v?" selected":""}`} onClick={()=>setShowTypeFilter(v)}>{l}</div>
            ))}
          </div>
        </div>
        {list.length?<div className="card-grid">
          {list.map(s=>{
            const isPLE=(s.showType||"weekly")==="ple";
            const matchCount=state.matches.filter(m=>m.showId===s.id).length;
            const wrestlerCount=state.wrestlers.filter(w=>w.showId===s.id).length;
            const champCount=state.championships.filter(c=>c.showId===s.id).length;
            const linked=(s.linkedShows||[]).map(lid=>state.shows.find(x=>x.id===lid)).filter(Boolean);
            return(<div key={s.id} className={`card${isPLE?" ple-card":""}`}>
              <div className="card-header">
                <div style={{display:"flex",gap:10,alignItems:"center",minWidth:0}}>
                  <div className="card-avatar" style={{borderRadius:8}}>{s.image?<img src={s.image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span className="card-avatar-placeholder"><i className={`fas ${isPLE?"fa-star":"fa-tv"}`}/></span>}</div>
                  <div style={{minWidth:0}}>
                    <div className="card-name" style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{width:14,height:14,borderRadius:"50%",background:s.color,display:"inline-block",flexShrink:0}}/>
                      {s.name}
                      {isPLE?<span className="card-badge badge-ple"><i className="fas fa-star"/> PLE</span>:<span className="card-badge badge-weekly">Weekly</span>}
                    </div>
                    {isPLE&&s.pleDate&&<div className="card-stat" style={{marginTop:0}}><i className="fas fa-calendar-day"/> {fmtDate(s.pleDate)}{s.venue&&<> &bull; <i className="fas fa-location-dot"/> {s.venue}</>}</div>}
                    {!isPLE&&s.day&&<div className="card-stat" style={{marginTop:0}}><i className="fas fa-calendar"/> {s.day}</div>}
                  </div>
                </div>
                {editMode&&<div className="card-actions">
                  <button onClick={()=>setModal({type:"show",data:s})}><i className="fas fa-pen"/></button>
                  <button className="delete-btn" onClick={()=>setConfirm({msg:`Delete <strong>${s.name}</strong>?`,fn:()=>deleteShow(s.id)})}><i className="fas fa-trash"/></button>
                </div>}
              </div>
              {isPLE?(linked.length>0?<><div style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.5px",marginTop:10,marginBottom:4}}><i className="fas fa-tv"/> Featured Shows</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{linked.map(ls=><span key={ls.id} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:20,fontSize:12,fontWeight:600,background:"var(--bg-input)",border:"1px solid var(--border)"}}><span style={{width:8,height:8,borderRadius:"50%",background:ls.color,display:"inline-block"}}/>{ls.name}</span>)}</div></>
                :<div style={{fontSize:12,color:"var(--text-muted)",fontStyle:"italic",marginTop:10}}>No shows linked</div>)
                :<><div className="card-stat"><i className="fas fa-users"/> {wrestlerCount} wrestlers</div>
                <div className="card-stat"><i className="fas fa-trophy"/> {champCount} championships</div></>}
              <div className="card-stat" style={{marginTop:8}}><i className="fas fa-bolt"/> {matchCount} matches</div>
              {s.description&&<div className="card-stat" style={{marginTop:6,fontStyle:"italic"}}>{s.description}</div>}
            </div>);
          })}
        </div>:<div className="empty-state"><i className="fas fa-tv"/><p>No shows yet.</p></div>}
      </div>
    );
  };

  const TagTeams=({editMode})=>{
    const tagCount=state.tagTeams.filter(t=>getGroupMembers(t).length<=2).length;
    const trioCount=state.tagTeams.filter(t=>getGroupMembers(t).length===3).length;
    const stableCount=state.tagTeams.filter(t=>getGroupMembers(t).length>=4).length;

    const list=state.tagTeams.filter(t=>{
      if(tagSearch&&!t.name.toLowerCase().includes(tagSearch.toLowerCase()))return false;
      if(gtFilter==="tag"&&getGroupMembers(t).length!==2)return false;
      if(gtFilter==="trio"&&getGroupMembers(t).length!==3)return false;
      if(gtFilter==="stable"&&getGroupMembers(t).length<4)return false;
      return true;
    });

    const typeColor=(n)=>n===2?"var(--primary)":n===3?"var(--success)":"var(--accent)";
    const typeLabel=(n)=>groupTypeLabel(n);

    return(
      <div>
        <div className="section-header">
          <div className="section-title">Groups <span className="count">({state.tagTeams.length})</span></div>
          {editMode&&<button className="btn btn-primary" onClick={()=>setModal({type:"tagTeam",data:null})}><i className="fas fa-plus"/> Add Group</button>}
        </div>
        <div className="filter-bar">
          <div className="search-box"><i className="fas fa-search"/><input type="text" placeholder="Search groups..." value={tagSearch} onChange={e=>setTagSearch(e.target.value)}/></div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {[{v:"",l:`All (${state.tagTeams.length})`},{v:"tag",l:`Tag Teams (${tagCount})`},{v:"trio",l:`Trios (${trioCount})`},{v:"stable",l:`Stables (${stableCount})`}].map(({v,l})=>(
              <div key={v} className={`chip${gtFilter===v?" selected":""}`} onClick={()=>setGtFilter(v)}>{l}</div>
            ))}
          </div>
        </div>
        {list.length?<div className="card-grid">
          {list.map(t=>{
            const mids=getGroupMembers(t);
            const rec=getTagRecord(t.id,state.matches);
            const champs=state.championships.filter(c=>c.type==="tag"&&c.currentHolderId===t.id);
            const winPct=rec.total>0?Math.round(rec.pct*100):0;
            const tColor=typeColor(mids.length);
            const tLabel=typeLabel(mids.length);
            return(<div key={t.id} className="card" style={{borderLeft:`3px solid ${tColor}`}}>
              <div className="card-header">
                <div style={{minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                    <span style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.5px",padding:"2px 8px",borderRadius:20,background:tColor+"22",color:tColor,border:`1px solid ${tColor}44`}}>{tLabel}</span>
                  </div>
                  <div className="card-name">{t.name}</div>
                </div>
                {editMode&&<div className="card-actions">
                  <button onClick={()=>setModal({type:"tagTeam",data:t})}><i className="fas fa-pen"/></button>
                  <button className="delete-btn" onClick={()=>setConfirm({msg:`Delete <strong>${t.name}</strong>?`,fn:()=>deleteTagTeam(t.id)})}><i className="fas fa-trash"/></button>
                </div>}
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:4}}>
                {mids.map((mid,i)=>(
                  <span key={mid+i} style={{fontSize:12,padding:"3px 10px",background:"var(--bg-input)",borderRadius:20,color:"var(--text-secondary)",border:"1px solid var(--border)",display:"flex",alignItems:"center",gap:5}}>
                    <span style={{width:16,height:16,borderRadius:"50%",background:"var(--border)",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"var(--text-muted)",flexShrink:0}}>{i+1}</span>
                    {wName(mid)}
                  </span>
                ))}
              </div>
              <div className="win-loss" style={{marginTop:10}}><span className="wins">{rec.wins}W</span><span className="losses">{rec.losses}L</span><span style={{color:"var(--text-muted)"}}>{winPct}%</span></div>
              {rec.total>0&&<div className="record-bar"><div className="win-bar" style={{width:(rec.wins/rec.total*100)+"%"}}/><div className="loss-bar" style={{width:(rec.losses/rec.total*100)+"%"}}/></div>}
              {champs.length>0&&<div style={{marginTop:8}}>{champs.map(c=><span key={c.id} className="card-badge badge-champion"><i className="fas fa-trophy"/> {c.name}</span>)}</div>}
            </div>);
          })}
        </div>:<div className="empty-state"><i className="fas fa-people-group"/><p>No groups found. Add tag teams, trios, or stables!</p></div>}
      </div>
    );
  };

  const Championships=({editMode})=>(
    <div>
      <div className="section-header"><div className="section-title">Championships <span className="count">({state.championships.length})</span></div>{editMode&&<button className="btn btn-primary" onClick={()=>setModal({type:"championship",data:null})}><i className="fas fa-plus"/> Add Championship</button>}</div>
      {state.championships.length?<div className="card-grid">
        {state.championships.map(c=>{
          const isMITB=c.type==="mitb";const isTag=c.type==="tag";
          const holderName=c.currentHolderId?(isTag?tName(c.currentHolderId):wName(c.currentHolderId)):"Vacant";
          const show=state.shows.find(s=>s.id===c.showId);
          return(<div key={c.id} className={`card${isMITB?" mitb-card":""}`} style={{cursor:"pointer"}} onClick={e=>{if(!e.target.closest(".card-actions")&&!e.target.closest(".btn-cashin"))setProfileModal({type:"championship",data:c});}}>
            <div className="card-header">
              <div style={{display:"flex",gap:10,alignItems:"center",minWidth:0}}>
                <div className="card-avatar" style={{borderRadius:6}}>{c.image?<img src={c.image} alt="" style={{width:"100%",height:"100%",objectFit:"contain"}}/>:<span className="card-avatar-placeholder"><i className={`fas ${isMITB?"fa-briefcase":"fa-trophy"}`}/></span>}</div>
                <div style={{minWidth:0}}>
                  <div className="card-name" style={{color:isMITB?"var(--success)":"var(--accent)"}}>{c.name}</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:2}}>
                    {isMITB?<span className="card-badge badge-mitb"><i className="fas fa-briefcase"/> MITB</span>:<span className="card-badge badge-show">{isTag?"Tag / Group":"Singles"}</span>}
                    {show&&<span className="card-badge badge-show"><span style={{width:8,height:8,borderRadius:"50%",background:show.color,display:"inline-block"}}/> {show.name}</span>}
                  </div>
                </div>
              </div>
              {editMode&&<div className="card-actions">
                <button onClick={e=>{e.stopPropagation();setModal({type:"championship",data:c});}}><i className="fas fa-pen"/></button>
                <button className="delete-btn" onClick={e=>{e.stopPropagation();setConfirm({msg:`Delete <strong>${c.name}</strong>?`,fn:()=>deleteChampionship(c.id)});}}><i className="fas fa-trash"/></button>
              </div>}
            </div>
            {c.image&&<div style={{width:"100%",padding:"16px 0",display:"flex",justifyContent:"center",alignItems:"center",background:isMITB?"linear-gradient(135deg,rgba(34,197,94,0.08),rgba(22,163,74,0.04))":"linear-gradient(135deg,rgba(255,215,0,0.08),rgba(229,26,44,0.06))",borderRadius:6,marginTop:8,border:`1px solid ${isMITB?"rgba(34,197,94,0.15)":"rgba(255,215,0,0.15)"}`}}>
              <img src={c.image} alt={c.name} style={{maxWidth:140,maxHeight:100,objectFit:"contain"}}/>
            </div>}
            <div style={{display:"flex",alignItems:"center",gap:10,marginTop:10,padding:10,background:"var(--bg-input)",borderRadius:6}}>
              <div style={{flex:1}}>
                <div style={{fontSize:11,color:"var(--text-muted)",textTransform:"uppercase",letterSpacing:"0.5px"}}>{isMITB?"Briefcase Holder":"Current Champion"}</div>
                <div style={{fontFamily:"Teko,sans-serif",fontSize:20,fontWeight:600,textTransform:"uppercase"}}>{c.currentHolderId?holderName:<span style={{color:"var(--text-muted)",fontStyle:"italic"}}>{isMITB?"Unclaimed":"Vacant"}</span>}</div>
                {!isMITB&&c.currentHolderId&&<div style={{fontSize:13,color:"var(--accent)",fontWeight:600}}><i className="fas fa-shield-halved"/> {c.defenses} defense{c.defenses!==1?"s":""}</div>}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
                {isMITB&&c.currentHolderId&&editMode&&<button className="btn-cashin" onClick={e=>{e.stopPropagation();setModal({type:"cashIn",data:c});}}><i className="fas fa-bolt"/> Cash In</button>}
                {c.currentHolderId&&editMode&&<button
                  onClick={e=>{e.stopPropagation();setConfirm({msg:`Vacate <strong>${c.name}</strong>? The current reign will be saved to title history.`,fn:()=>vacateChampionship(c.id),confirmLabel:"Vacate",confirmClass:"btn-secondary"});}}
                  style={{padding:"4px 10px",borderRadius:"var(--radius-sm)",border:"1px solid rgba(239,68,68,0.4)",background:"rgba(239,68,68,0.08)",color:"var(--error)",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"Outfit,sans-serif",whiteSpace:"nowrap"}}>
                  <i className="fas fa-ban"/> Vacate
                </button>}
              </div>
            </div>
          </div>);
        })}
      </div>:<div className="empty-state"><i className="fas fa-trophy"/><p>No championships created yet.</p></div>}
    </div>
  );

  const Matches=({editMode})=>{
    let list=[...state.matches].sort((a,b)=>{
      const dateDiff=new Date(b.date)-new Date(a.date);
      if(dateDiff!==0)return dateDiff;
      // Same date — sort by insertion order descending (most recently added first)
      return state.matches.indexOf(b)-state.matches.indexOf(a);
    });
    if(matchSearch){list=list.filter(m=>{
      const names=sa(m.wrestlers).map(id=>wName(id).toLowerCase());
      sa(m.tagTeamIds).forEach(tid=>names.push(tName(tid).toLowerCase()));
      sa(m.adhocTeams).forEach(at=>names.push((at.label||"").toLowerCase()));
      return names.some(n=>n.includes(matchSearch.toLowerCase()));
    });}
    if(matchShowFilter)list=list.filter(m=>m.showId===matchShowFilter);
    return(
      <div>
        <div className="section-header"><div className="section-title">Matches <span className="count">({state.matches.length})</span></div>
          {editMode&&<div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button className="btn btn-secondary btn-sm" onClick={()=>setModal({type:"matchTypes",data:null})}><i className="fas fa-gear"/> Match Types</button>
            <button className="btn btn-primary" onClick={()=>setModal({type:"match",data:null})}><i className="fas fa-plus"/> Record Match</button>
          </div>}
        </div>
        <div className="filter-bar">
          <div className="search-box"><i className="fas fa-search"/><input type="text" placeholder="Search by wrestler or team..." value={matchSearch} onChange={e=>setMatchSearch(e.target.value)}/></div>
          <select className="filter-select" value={matchShowFilter} onChange={e=>setMatchShowFilter(e.target.value)}>
            <option value="">All Shows</option>
            {state.shows.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        {list.length?<div className="match-list">{list.map(m=><MatchCard key={m.id} m={m} editMode={editMode}/>)}</div>:<div className="empty-state"><i className="fas fa-bolt"/><p>No matches recorded yet.</p></div>}
      </div>
    );
  };

  const Rankings=({editMode})=>(
    <div>
      <div className="section-header"><div className="section-title">Power Rankings</div></div>
      {ranked.length?<div className="ranking-list">
        {ranked.map((w,i)=>{
          const rec=getRecord(w.id,state.matches);const rating=getPowerRating(w.id,state);const streak=getStreak(w.id,state.matches);const champs=getCurrentChampionships(w.id,state.championships);
          return(<div key={w.id} className="ranking-item" style={{cursor:"pointer",borderLeft:i===1?"3px solid #C0C0C0":i===2?"3px solid #CD7F32":""}} onClick={()=>setProfileModal({type:"wrestler",data:w})}>
            <div className="rank-number" style={{color:i===0?"var(--accent)":i===1?"#C0C0C0":i===2?"#CD7F32":"var(--text-muted)"}}>{i+1}</div>
            <div className="card-avatar-sm">{w.image?<img src={w.image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span className="card-avatar-placeholder" style={{fontSize:14}}><i className="fas fa-user"/></span>}</div>
            <div className="rank-info">
              <div className="rank-name">{w.name}{champs.map(c=><i key={c.id} className="fas fa-trophy rank-champ-icon" title={c.name}/>)}</div>
              <div className="rank-stats"><span className="badge-win">{rec.wins}W</span> <span className="badge-loss">{rec.losses}L</span> <span>{Math.round(rec.pct*100)}%</span>
                {streak!==0&&<span style={{color:streak>0?"var(--success)":"var(--error)"}}>{streak>0?`🔥${streak}W Streak`:`❌${Math.abs(streak)}L Streak`}</span>}
              </div>
            </div>
            <div className="rank-rating"><div className="rating-value">{rating}</div><div className="rating-label">PWR</div><div className="rating-bar"><div className="rating-bar-fill" style={{width:rating+"%"}}/></div></div>
          </div>);
        })}
      </div>:<div className="empty-state"><i className="fas fa-ranking-star"/><p>Add wrestlers and record matches to see power rankings.</p></div>}
    </div>
  );

  const TABS=[{id:"dashboard",icon:"fa-th-large",label:"Dashboard"},{id:"roster",icon:"fa-users",label:"Roster"},{id:"shows",icon:"fa-tv",label:"Shows"},{id:"tag-teams",icon:"fa-people-group",label:"Groups"},{id:"championships",icon:"fa-trophy",label:"Championships"},{id:"matches",icon:"fa-bolt",label:"Matches"},{id:"rankings",icon:"fa-ranking-star",label:"Rankings"}];

  return(
    <>
      <style>{`
        :root {
          --bg-deep:#0B0B0F;--bg-surface:#141419;--bg-card:#1A1A22;--bg-card-hover:#22222E;--bg-input:#1E1E28;
          --primary:#E51A2C;--primary-dark:#B8141F;--primary-glow:rgba(229,26,44,0.3);
          --accent:#FFD700;--accent-dim:#C5A600;--accent-glow:rgba(255,215,0,0.25);
          --text:#F0F0F5;--text-secondary:#8A8AA0;--text-muted:#55556A;
          --success:#22C55E;--error:#EF4444;--warning:#F59E0B;
          --border:#2A2A38;--border-light:#35354A;--shadow:0 4px 24px rgba(0,0,0,0.4);
          --radius:10px;--radius-sm:6px;--transition:0.2s ease;
        }
        @media(prefers-color-scheme:light){:root{--bg-deep:#F2F2F7;--bg-surface:#FFFFFF;--bg-card:#FFFFFF;--bg-card-hover:#F8F8FC;--bg-input:#F0F0F5;--text:#1A1A2E;--text-secondary:#6A6A80;--text-muted:#9A9AB0;--border:#E0E0EA;--border-light:#D0D0DA;--shadow:0 4px 24px rgba(0,0,0,0.08);}}
        *{margin:0;padding:0;box-sizing:border-box;}
        body{font-family:'Outfit',sans-serif;background:var(--bg-deep);color:var(--text);}
        .app-header{position:fixed;top:0;left:0;right:0;height:60px;background:var(--bg-surface);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 16px;z-index:100;}
        .app-logo{display:flex;align-items:center;gap:10px;user-select:none;}
        .app-logo-icon{width:36px;height:36px;background:linear-gradient(135deg,var(--primary),var(--accent));border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;font-weight:700;font-family:'Teko',sans-serif;}
        .app-logo-text{font-family:'Teko',sans-serif;font-size:22px;font-weight:600;letter-spacing:1px;text-transform:uppercase;}
        .header-actions{display:flex;gap:8px;align-items:center;}
        .btn-icon{width:38px;height:38px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-card);color:var(--text-secondary);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all var(--transition);font-size:15px;}
        .btn-icon:hover{background:var(--bg-card-hover);color:var(--text);}
        .btn-save{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-card);color:var(--text-secondary);cursor:pointer;font-size:13px;font-family:'Outfit',sans-serif;font-weight:500;transition:all var(--transition);}
        .btn-save:hover{background:var(--bg-card-hover);color:var(--text);}
        .btn-save.unsaved{border-color:var(--error);color:var(--error);}
        .tab-nav{position:fixed;top:60px;left:0;right:0;height:48px;background:var(--bg-surface);border-bottom:2px solid var(--border);display:flex;overflow-x:auto;scrollbar-width:none;z-index:99;}
        .tab-nav::-webkit-scrollbar{display:none;}
        .tab-btn{flex-shrink:0;padding:0 18px;height:100%;border:none;background:none;color:var(--text-muted);font-family:'Outfit',sans-serif;font-size:13px;font-weight:500;cursor:pointer;display:flex;align-items:center;gap:7px;transition:all var(--transition);position:relative;white-space:nowrap;}
        .tab-btn:hover{color:var(--text-secondary);}
        .tab-btn.active{color:var(--primary);font-weight:600;}
        .tab-btn.active::after{content:'';position:absolute;bottom:-2px;left:8px;right:8px;height:3px;background:var(--primary);border-radius:3px 3px 0 0;}
        .main-content{margin-top:108px;padding:20px 16px 100px;max-width:1100px;margin-left:auto;margin-right:auto;}
        .section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;}
        .section-title{font-family:'Teko',sans-serif;font-size:32px;font-weight:600;letter-spacing:1px;text-transform:uppercase;line-height:1;}
        .section-title .count{font-size:18px;color:var(--text-muted);font-weight:400;margin-left:8px;}
        .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:var(--radius-sm);font-family:'Outfit',sans-serif;font-size:14px;font-weight:600;border:none;cursor:pointer;transition:all var(--transition);}
        .btn-primary{background:var(--primary);color:#fff;}
        .btn-primary:hover{background:var(--primary-dark);}
        .btn-secondary{background:var(--bg-card);color:var(--text);border:1px solid var(--border);}
        .btn-secondary:hover{background:var(--bg-card-hover);}
        .btn-danger{background:transparent;color:var(--error);border:1px solid var(--error);}
        .btn-danger:hover{background:rgba(239,68,68,0.1);}
        .btn-sm{padding:6px 14px;font-size:13px;}
        .btn-cashin{background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;border:none;padding:6px 14px;border-radius:var(--radius-sm);font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:all var(--transition);font-family:'Teko',sans-serif;}
        .btn-cashin:hover{filter:brightness(1.1);}
        .card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;}
        .card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;transition:all var(--transition);position:relative;overflow:hidden;}
        .card:hover{border-color:var(--border-light);box-shadow:var(--shadow);transform:translateY(-1px);}
        .ple-card{border:1px solid rgba(156,39,176,0.35);background:linear-gradient(160deg,var(--bg-card),rgba(156,39,176,0.06));}
        .ple-card:hover{border-color:rgba(156,39,176,0.55);}
        .mitb-card{border:1px solid rgba(34,197,94,0.3);background:linear-gradient(160deg,var(--bg-card),rgba(34,197,94,0.04));}
        .mitb-card:hover{border-color:rgba(34,197,94,0.5);}
        .card-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:10px;}
        .card-name{font-family:'Teko',sans-serif;font-size:22px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;line-height:1.1;}
        .card-nickname{font-size:12px;color:var(--accent);font-weight:500;font-style:italic;}
        .card-stat{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary);margin-top:4px;}
        .card-actions{display:flex;gap:4px;flex-shrink:0;}
        .card-actions button,.card-action-btn{width:30px;height:30px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-input);color:var(--text-muted);cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;transition:all var(--transition);}
        .card-actions button:hover,.card-action-btn:hover{color:var(--text);border-color:var(--border-light);}
        .card-actions button.delete-btn:hover,.card-action-btn.delete:hover{color:var(--error);border-color:var(--error);}
        .card-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;}
        .badge-champion{background:linear-gradient(135deg,var(--accent),#FFA500);color:#1A1A00;}
        .badge-show{background:var(--bg-input);color:var(--text-secondary);border:1px solid var(--border);}
        .badge-ple{background:linear-gradient(135deg,#9C27B0,#E040FB);color:#fff;font-weight:700;letter-spacing:1px;}
        .badge-weekly{background:var(--bg-input);color:var(--text-secondary);border:1px solid var(--border);}
        .badge-mitb{background:linear-gradient(135deg,#16a34a,#22c55e);color:#fff;font-weight:700;}
        .win-loss{display:flex;gap:12px;margin-top:8px;font-size:14px;font-weight:600;}
        .wins{color:var(--success);}.losses{color:var(--error);}
        .record-bar{height:4px;background:var(--bg-input);border-radius:2px;margin-top:8px;overflow:hidden;display:flex;}
        .win-bar{background:var(--success);transition:width 0.4s ease;}
        .loss-bar{background:var(--error);transition:width 0.4s ease;}
        .card-avatar{width:48px;height:48px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--bg-input);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;}
        .card-avatar-sm{width:36px;height:36px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--bg-input);border:2px solid var(--border);display:flex;align-items:center;justify-content:center;}
        .card-avatar-placeholder{color:var(--text-muted);font-size:18px;}
        .stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px;}
        .stat-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;text-align:center;}
        .stat-value{font-family:'Teko',sans-serif;font-size:40px;font-weight:700;line-height:1;}
        .stat-label{font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;margin-top:4px;}
        .stat-card.primary .stat-value{color:var(--primary);}
        .stat-card.gold .stat-value{color:var(--accent);}
        .stat-card.green .stat-value{color:var(--success);}
        .dash-section{margin-bottom:28px;}
        .dash-section-title{font-family:'Teko',sans-serif;font-size:22px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;}
        .dash-section-title i{color:var(--accent);font-size:16px;}
        .champions-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;}
        .champion-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:14px;display:flex;flex-direction:column;gap:10px;transition:all var(--transition);}
        .champion-card:hover{border-color:var(--accent-dim);}
        .champion-card-top{display:flex;align-items:center;gap:10px;min-width:0;}
        .champion-info{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1;}
        .champion-belt{font-size:12px;font-weight:600;color:var(--accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px;}
        .champion-name{font-family:'Teko',sans-serif;font-size:22px;font-weight:600;text-transform:uppercase;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .champion-vacant{color:var(--text-muted);font-style:italic;font-size:18px;}
        .champion-card-bottom{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:8px;border-top:1px solid var(--border);}
        .champion-defenses{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--text-secondary);}
        .champion-defenses i{color:var(--accent);}
        .champion-defenses-count{font-family:'Teko',sans-serif;font-size:18px;font-weight:700;color:var(--accent);line-height:1;}
        .match-list{display:flex;flex-direction:column;gap:10px;}
        .match-card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;transition:all var(--transition);}
        .match-card:hover{border-color:var(--border-light);}
        .match-type-badge{padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;background:var(--bg-input);color:var(--text-secondary);border:1px solid var(--border);}
        .match-type-badge.championship{background:linear-gradient(135deg,var(--accent),#FFA500);color:#1A1A00;border:none;}
        .ranking-list{display:flex;flex-direction:column;gap:8px;}
        .ranking-item{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;display:flex;align-items:center;gap:14px;transition:all var(--transition);}
        .ranking-item:hover{border-color:var(--border-light);}
        .ranking-item:first-child{border-color:var(--accent-dim);}
        .rank-number{font-family:'Teko',sans-serif;font-size:32px;font-weight:700;color:var(--text-muted);width:40px;text-align:center;flex-shrink:0;}
        .rank-info{flex:1;min-width:0;}
        .rank-name{font-family:'Teko',sans-serif;font-size:22px;font-weight:600;text-transform:uppercase;line-height:1.1;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
        .rank-champ-icon{color:var(--accent);font-size:14px;flex-shrink:0;}
        .rank-stats{display:flex;gap:12px;font-size:12px;color:var(--text-secondary);margin-top:3px;}
        .rank-rating{display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;}
        .rating-value{font-family:'Teko',sans-serif;font-size:28px;font-weight:700;color:var(--primary);line-height:1;}
        .rating-label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;}
        .rating-bar{width:80px;height:4px;background:var(--bg-input);border-radius:2px;margin-top:4px;overflow:hidden;}
        .rating-bar-fill{height:100%;background:linear-gradient(90deg,var(--primary),var(--accent));border-radius:2px;transition:width 0.5s ease;}
        .badge-win{color:var(--success);}.badge-loss{color:var(--error);}
        .filter-bar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center;}
        .search-box{flex:1;min-width:180px;position:relative;}
        .search-box i{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:14px;}
        .search-box input{width:100%;padding:9px 14px 9px 36px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:'Outfit',sans-serif;font-size:16px;transition:all var(--transition);}
        .search-box input:focus{outline:none;border-color:var(--primary);}
        .filter-select{padding:9px 32px 9px 14px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:'Outfit',sans-serif;font-size:16px;appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238A8AA0' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;}
        .filter-select:focus{outline:none;border-color:var(--primary);}
        .form-group{margin-bottom:16px;}
        .form-label{display:block;font-size:13px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;}
        .form-input,.form-select,.form-textarea{width:100%;padding:10px 14px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text);font-family:'Outfit',sans-serif;font-size:16px;transition:all var(--transition);}
        .form-input:focus,.form-select:focus,.form-textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px var(--primary-glow);}
        .form-select{appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238A8AA0' d='M6 8L1 3h10z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;padding-right:32px;}
        .form-textarea{resize:vertical;min-height:70px;}
        .form-hint{font-size:12px;color:var(--text-muted);margin-top:4px;line-height:1.4;}
        .modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:200;padding:16px;animation:fadeIn 0.2s ease;}
        .modal{background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--radius);width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,0.6);animation:slideUp 0.25s ease;}
        .modal-header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--bg-surface);z-index:1;}
        .modal-title{font-family:'Teko',sans-serif;font-size:24px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;}
        .modal-close{width:34px;height:34px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-card);color:var(--text-secondary);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all var(--transition);}
        .modal-close:hover{color:var(--text);}
        .modal-body{padding:20px;}
        .modal-footer{padding:16px 20px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px;}
        .chip{padding:5px 12px;border-radius:20px;font-size:13px;font-weight:500;background:var(--bg-input);border:1px solid var(--border);color:var(--text-secondary);cursor:pointer;transition:all var(--transition);user-select:none;}
        .chip:hover{border-color:var(--border-light);color:var(--text);}
        .chip.selected{background:var(--primary);border-color:var(--primary);color:#fff;}
        .chip.winner-chip.selected{background:var(--success);border-color:var(--success);color:#fff;}
        .empty-state{text-align:center;padding:48px 20px;color:var(--text-muted);}
        .empty-state i{font-size:48px;margin-bottom:16px;opacity:0.3;display:block;}
        .empty-state p{font-size:15px;margin-bottom:16px;}
        .toast-container{position:fixed;bottom:20px;right:20px;z-index:300;display:flex;flex-direction:column;gap:8px;}
        .toast{padding:12px 20px;border-radius:var(--radius-sm);font-size:14px;font-weight:500;color:#fff;background:var(--bg-card);border:1px solid var(--border);box-shadow:var(--shadow);animation:toastIn 0.3s ease;display:flex;align-items:center;gap:8px;}
        .toast.success{border-left:3px solid var(--success);}
        .toast.error{border-left:3px solid var(--error);}
        .toast.info{border-left:3px solid var(--primary);}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes toastIn{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
        ::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
        @media(max-width:640px){.card-grid{grid-template-columns:1fr}.stats-row{grid-template-columns:repeat(2,1fr)}.filter-bar{flex-direction:column}.search-box{min-width:100%}.tab-btn{padding:0 13px;font-size:12px}}
      `}</style>

      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">2K</div>
          <div className="app-logo-text"><span style={{color:"var(--primary)"}}>WWE</span> 2K26 Tracker</div>
        </div>
        <div className="header-actions">
          {/* Edit mode indicator + toggle */}
          <button
            onClick={()=>{
              if(editMode){setEditMode(false);}
              else if(!state.editPassword){setEditMode(true);}  // no password set — unlock directly
              else{setEditPasswordModal(true);}
            }}
            title={editMode?"Switch back to view-only mode":state.editPassword?"Unlock editing (password required)":"Unlock editing (no password set)"}
            style={{display:"flex",alignItems:"center",gap:6,padding:"6px 12px",borderRadius:"var(--radius-sm)",
              border:`1px solid ${editMode?"var(--success)":"var(--border)"}`,
              background:editMode?"rgba(34,197,94,0.1)":"var(--bg-card)",
              color:editMode?"var(--success)":"var(--text-muted)",
              cursor:"pointer",fontSize:13,fontFamily:"Outfit,sans-serif",fontWeight:600,transition:"all 0.2s"}}>
            <i className={`fas ${editMode?"fa-lock-open":state.editPassword?"fa-lock":"fa-lock-open"}`}/>
            {editMode?"Editing":state.editPassword?"View Only":"Edit"}
          </button>
          {activeSlot&&<span style={{fontSize:12,color:"var(--text-muted)",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"none"}} className="active-slot-label">📁 {activeSlot}</span>}
          <button className={`btn-save${unsaved?" unsaved":""}`} onClick={()=>setCloudModal(true)}>
            <i className="fas fa-cloud"/> {editMode?(activeSlot?unsaved?"Unsaved!":"Cloud Saves":"Cloud Saves"):"Load Save"}
          </button>
          <input type="file" ref={importRef} accept=".json" style={{display:"none"}} onChange={importData}/>
        </div>
      </header>

      {!isSupabaseConfigured&&(
        <div style={{position:"fixed",top:60,left:0,right:0,zIndex:98,background:"#7a1f1f",color:"#fff",padding:"6px 16px",fontSize:12,textAlign:"center",lineHeight:1.4}}>
          <i className="fas fa-triangle-exclamation"/> Cloud Saves not configured — add Supabase keys to <code>.env</code>. Local export/import still works. See README.md.
        </div>
      )}

      <nav className="tab-nav" style={!isSupabaseConfigured?{top:84}:undefined}>
        {TABS.map(t=>(
          <button key={t.id} className={`tab-btn${view===t.id?" active":""}`} onClick={()=>setView(t.id)}>
            <i className={`fas ${t.icon}`}/> {t.label}
          </button>
        ))}
      </nav>

      <main className="main-content" style={!isSupabaseConfigured?{marginTop:132}:undefined}>
        {/* Guard: don't render views if core state arrays aren't ready */}
        {state.wrestlers&&state.matches&&state.shows?(
          <>
            {view==="dashboard"&&<Dashboard editMode={editMode}/>}
            {view==="roster"&&<Roster editMode={editMode}/>}
            {view==="shows"&&<Shows editMode={editMode}/>}
            {view==="tag-teams"&&<TagTeams editMode={editMode}/>}
            {view==="championships"&&<Championships editMode={editMode}/>}
            {view==="matches"&&<Matches editMode={editMode}/>}
            {view==="rankings"&&<Rankings editMode={editMode}/>}
          </>
        ):(
          <div style={{textAlign:"center",padding:80,color:"var(--text-muted)"}}>
            <i className="fas fa-spinner fa-spin" style={{fontSize:32,display:"block",marginBottom:12}}/>
            Loading...
          </div>
        )}
      </main>

      {/* Edit Password Modal */}
      {editPasswordModal&&<EditPasswordModal onUnlock={()=>setEditMode(true)} onClose={()=>setEditPasswordModal(false)} editPassword={state.editPassword}/>}

      {/* Cloud Save Modal */}
      {cloudModal&&<CloudSaveModal
        onClose={()=>setCloudModal(false)}
        activeSlot={activeSlot}
        setActiveSlot={setActiveSlot}
        state={state}
        setState={setState}
        setUnsaved={setUnsaved}
        addToast={addToast}
        exportData={exportData}
        importRef={importRef}
        setConfirm={setConfirm}
        setEditMode={setEditMode}
        setView={setView}
      />}

      {/* Modals */}
      {modal?.type==="wrestler"&&<WrestlerModal wrestler={modal.data} shows={state.shows} onSave={(d)=>saveWrestler(modal.data?.id,d)} onClose={()=>setModal(null)}/>}
      {modal?.type==="show"&&<ShowModal show={modal.data} shows={state.shows} onSave={(d)=>saveShow(modal.data?.id,d)} onClose={()=>setModal(null)}/>}
      {modal?.type==="tagTeam"&&<TagTeamModal team={modal.data} wrestlers={state.wrestlers} onSave={(d)=>saveTagTeam(modal.data?.id,d)} onClose={()=>setModal(null)}/>}
      {modal?.type==="championship"&&<ChampionshipModal champ={modal.data} shows={state.shows} wrestlers={state.wrestlers} tagTeams={state.tagTeams} onSave={(d)=>saveChampionship(modal.data?.id,d)} onClose={()=>setModal(null)}/>}
      {modal?.type==="match"&&<MatchModal match={modal.data} state={state} onSave={(d)=>saveMatch(modal.data?.id,d)} onClose={()=>setModal(null)} toast={addToast}/>}
      {modal?.type==="cashIn"&&<CashInModal mitb={modal.data} state={state} onCashIn={executeCashIn} onClose={()=>setModal(null)}/>}
      {modal?.type==="matchTypes"&&<MatchTypesModal matchTypes={state.matchTypes} onSave={saveMatchType} onDelete={deleteMatchType} onClose={()=>setModal(null)}/>}

      {/* Profile Modals */}
      {profileModal?.type==="wrestler"&&<WrestlerProfile w={profileModal.data} state={state} onClose={()=>setProfileModal(null)}/>}
      {profileModal?.type==="championship"&&<ChampionshipProfile c={profileModal.data} state={state} onClose={()=>setProfileModal(null)}/>}

      {/* Confirm */}
      {confirm&&<ConfirmModal message={confirm.msg} onConfirm={confirm.fn} onClose={()=>setConfirm(null)} confirmLabel={confirm.confirmLabel} confirmClass={confirm.confirmClass}/>}

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(t=>(
          <div key={t.id} className={`toast ${t.type}`}>
            <i className={`fas ${t.type==="success"?"fa-check-circle":t.type==="error"?"fa-exclamation-circle":"fa-info-circle"}`}/>
            {t.msg}
          </div>
        ))}
      </div>
    </>
  );
}

// Wrap in ErrorBoundary so any render crash shows a friendly recovery screen
// instead of a blank white page
const AppWithBoundary=()=><ErrorBoundary><App/></ErrorBoundary>;
export default AppWithBoundary;
