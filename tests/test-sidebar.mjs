import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { activityBySpace, findNode } from "../herdr/mods/hcconfig-team/activity.js";

const spaces = [{id:"a",name:"Project A"},{id:"b",name:"Project B"},{id:"remote/a",name:"Remote A"}];
const terminal = (address, role, status, space = "a", tab = "tab-a") => ({address,state:"live",status,labels:{"herdrconfig.role":role,"herdr.space":space,"herdr.tab":tab}});
let list = [terminal("t1","reviewer","working","b","tab-b"),terminal("t2","planner","idle"),terminal("t3","executor","blocked"),
  {...terminal("t4","reviewer","working"),state:"finished"}, {address:"shell",state:"live",labels:{"herdr.space":"a"}},
  terminal("remote/t1","reviewer","working","a","tab-a"),
  {address:"t5",parent:"t1",state:"live",status:"working",program:{agent:true,name:"Codex"},labels:{}}];
let groups = activityBySpace(spaces,list,[]);
assert.equal(groups[0].active.length,1); assert.equal(groups[0].idle.length,1);
assert.equal(groups[0].active[0].status,"blocked");
assert.equal(groups[1].active[0].label,"Reviewer");
assert.equal(groups[1].active[1].label,"Codex"); // Do not inherit the parent's role.
assert.equal(groups[1].active[1].tab,"tab-b");
assert.equal(groups[2].active[0].space,"remote/a"); assert.equal(groups[2].active[0].tab,"remote/tab-a");
assert.ok(!groups.flatMap(g=>[...g.active,...g.idle]).some(a=>["shell","t4"].includes(a.address)));
assert.deepEqual(activityBySpace(spaces,[{address:"x",parent:"y",state:"live",program:{agent:true}},{address:"y",parent:"x",state:"live",program:{agent:true}}],[]).map(g=>g.active),[[],[],[]]);
const reported = activityBySpace(spaces,[terminal("t1","reviewer","working")],[{address:"t1",space:"b",tab:"new-tab",status:"idle"}]);
assert.equal(reported[1].idle[0].tab,"new-tab"); // Listed live ownership/status overrides old labels.

const source = (await readFile(new URL("../herdr/mods/hcconfig-team/main.js",import.meta.url),"utf8")).replace(/^import .*;\r?\n/gm,"").replace("export default class Team","return class Team");
const actions=[], state=new Map();
const tree={id:"hcconfig-root",children:[{id:"hcconfig-git",hidden:false}]};
const values={View:class{},run:(name,args)=>{actions.push([name,args]); if(name==="layout.toggle") tree.children[0].hidden=!tree.children[0].hidden;},
  shared:key=>state.get(key),setShared:(key,value)=>state.set(key,value),activityBySpace,findNode};
const Team=new Function(...Object.keys(values),source)(...Object.values(values));
const panel=new Team(); panel.activity=()=>activityBySpace(spaces,list,[]);
panel.openAgent("t1");
assert.deepEqual(actions.splice(0),[["space.select",{id:"b"}],["tab.select",{id:"tab-b"}],["terminal.peek",{terminal:"t1"}]]);
list=list.filter(t=>t.address!=="t1"); panel.openAgent("t1"); assert.equal(actions.length,0);
panel.openAgent("remote/t1"); assert.deepEqual(actions.splice(0),[["space.select",{id:"remote/a"}],["tab.select",{id:"remote/tab-a"}],["terminal.peek",{terminal:"remote/t1"}]]);
panel.command("toggle-git"); assert.equal(findNode(tree,"hcconfig-git").hidden,true);
panel.command("toggle-git"); assert.equal(findNode(tree,"hcconfig-git").hidden,false);
panel.command("toggle-launcher"); assert.equal(state.get("hcconfig.launcher.open"),true);
panel.command("toggle-launcher"); assert.equal(state.get("hcconfig.launcher.open"),false);
console.log("PASS: sidebar ownership, parent/remote mapping, status, stale clicks, navigation and toggles (simulated host).");
