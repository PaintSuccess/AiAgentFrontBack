import { chromium } from "playwright";
function score(num){const d=num.replace(/[^0-9]/g,"");let best=1,pairs=0,rep=0;for(let i=0;i<d.length;i++){let r=1;while(i+r<d.length&&d[i+r]===d[i])r++;if(r>best)best=r;if(r>=2){rep+=r;i+=r-1;}}for(let i=0;i<d.length-1;i++)if(d[i]===d[i+1])pairs++;return best*100+pairs*10+rep;}
const b = await chromium.connectOverCDP("http://localhost:9333");
const p = b.contexts()[0].pages().find(p=>p.url().includes("twilio.com"));
await p.bringToFront();

const urls = [
  ["areaCode=2", "https://console.twilio.com/us1/develop/phone-numbers/manage/search?isoCountry=AU&types[]=Local&capabilities[]=Voice&areaCode=2&searchType=number&x-target-region=us1"],
  ["pageSize=60 areaCode=2", "https://console.twilio.com/us1/develop/phone-numbers/manage/search?isoCountry=AU&types[]=Local&capabilities[]=Voice&areaCode=2&searchType=number&pageSize=60&x-target-region=us1"],
];

for (const [label, url] of urls) {
  await p.goto(url, {waitUntil:"domcontentloaded"});
  await p.waitForLoadState("networkidle",{timeout:30000}).catch(()=>{});
  await p.waitForTimeout(3000);
  const btns = p.locator('button:has-text("Buy +61")');
  const n = await btns.count();
  console.log(`\n=== ${label} (${n} rows) ===`);
  const list=[];
  for(let i=0;i<n;i++){
    const t=(await btns.nth(i).innerText()).replace(/\s+/g," ").trim().replace(/^Buy /,"");
    list.push({num:t,s:score(t)});
  }
  list.sort((a,b)=>b.s-a.s);
  for(const c of list.slice(0,20)) console.log(`  [${c.s}] ${c.num}`);
}
