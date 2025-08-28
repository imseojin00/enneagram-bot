// server.js
const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const fs = require("fs");
const csv = require("csv-parser");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(cors());
app.use(express.static("public"));

// ======================
// 📌 DB 설정
// ======================
const db = new sqlite3.Database("./enneagram.db");
db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT,
      name TEXT,
      basic_type TEXT,
      wing TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  );
});

// ======================
// 📌 CSV 로드 + 정규화 인덱스
// ======================
const rowsIndexed = [];                 // { q11,q12,q21,q3,type, rawRow }
const indexMap = new Map();             // key: "q11-q12-q21-q3" -> rows (array)
let isCSVReady = false;

const csvFilePath = path.join(__dirname, "data", "enneagram_full_combinations.csv");

// 전각 숫자 → 반각 숫자
function toAsciiDigits(s) {
  return String(s || "").replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30)
  );
}
// "1|2|3" 중 첫 글자만 뽑기
function normalize13(input) {
  const txt = toAsciiDigits(input).replace(/^\uFEFF/, "").trim();
  const m = txt.match(/[1-3]/);
  return m ? m[0] : "";
}
// Q3를 "a-b-c"로 표준화
function normalizeQ3(text) {
  const txt = toAsciiDigits(text).replace(/^\uFEFF/, "").trim();
  if (/^\[.*\]$/.test(txt)) {
    try {
      const arr = JSON.parse(txt.replace(/'/g, '"'));
      const digits = (Array.isArray(arr) ? arr : [])
        .map((v) => toAsciiDigits(v).toString())
        .join(" ");
      const m = digits.match(/[1-9]/g);
      if (m && m.length >= 3) return m.slice(0, 3).join("-");
    } catch (_) {}
  }
  const m = txt.match(/[1-9]/g);
  if (!m || m.length < 3) return "";
  return m.slice(0, 3).join("-");
}
// 키 생성
function keyOf(q11, q12, q21, q3) {
  return `${q11}-${q12}-${q21}-${q3}`;
}

// CSV 읽기
if (!fs.existsSync(csvFilePath)) {
  console.error("❌ CSV 파일이 없습니다:", csvFilePath);
} else {
  fs.createReadStream(csvFilePath)
    .pipe(csv({ separator: "\t" }))   // 👈 탭 구분자 지정
    .on("data", (row) => {
      const clean = {};
      for (const [k, v] of Object.entries(row)) {
        const key = String(k).replace(/^\uFEFF/, "").trim();
        const val = typeof v === "string" ? v.trim() : v;
        clean[key] = val;
      }

      const q11 = normalize13(clean["Q1-1"]);
      const q12 = normalize13(clean["Q1-2"]);
      const q21 = normalize13(clean["Q2-1"]);
      const q3 = normalizeQ3(clean["Q3_order"]);
      const type = String(clean["Basic_Type"] ?? clean["Result"] ?? "")
        .replace(/^\uFEFF/, "")
        .trim();

      if (q11 && q12 && q21 && q3 && type) {
        const item = { q11, q12, q21, q3, type, rawRow: clean };
        rowsIndexed.push(item);
        const key = keyOf(q11, q12, q21, q3);
        if (!indexMap.has(key)) indexMap.set(key, []);
        indexMap.get(key).push(item);
      }
    })
    .on("end", () => {
      isCSVReady = true;
      console.log(`정규화 인덱스 ✅ ${rowsIndexed.length} 유효행`);

      const sampleQ3s = ["1-2-3", "2-8-3", "9-2-7"];
      for (const s of sampleQ3s) {
        const has = rowsIndexed.some((r) => r.q3 === s);
        console.log(`Q3 "${s}" 존재?`, has ? "YES" : "NO");
      }

      // 🔎 특정 조합 검사 (예: 3-3-1-2-8-3)
      const testKey = keyOf("3", "3", "1", "2-8-3");
      console.log("🔎 조합 3-3-1-2-8-3 존재?", indexMap.has(testKey));
    });
}

// ======================
// 📌 날개 설명(간단 버전, 선택용)
// ======================
const wingDesc = {
  1: { leftLabel: "1w9", rightLabel: "1w2", left: ["차분하고 온화하며 이상과 원칙을 동시에 추구", "감정을 과하게 드러내지 않고 신중함", "규칙과 조화를 중시", "스트레스 상황에서도 안정감 유지", "완벽함과 평화를 동시에 지향"], right: ["원칙적이면서도 타인을 돕고자 함", "사회적 책임감과 헌신이 강함", "이상을 행동으로 실천", "타인의 기대와 요구에 민감", "공동체 속에서 리더십 발휘"] },
  2: { leftLabel: "2w1", rightLabel: "2w3", left: ["도움을 주는 행동이 원칙/기준에 의해 조율", "헌신적이며 책임감이 강함", "과도한 자기희생을 경계", "도덕적 기준과 이상을 지킴", "사회적 조화를 중시"], right: ["인정받고 싶어하며 사교적", "관계를 즐기고 자기표현 활발", "성취와 매력 발휘에 관심", "인정·성취로 존재감 확인", "관계 속 영향력 행사"] },
  3: { leftLabel: "3w2", rightLabel: "3w4", left: ["사교적·협력적이며 성취를 추구", "칭찬/인정에 민감", "매력과 역량을 활용해 목표 달성", "타인의 기대를 반영하며 적극적", "관계와 성취의 결합"], right: ["성취와 자기표현의 결합", "감정의 깊이를 목표에 녹임", "독창성을 보여주려 노력", "성공과 정체성의 연결을 중시", "자기만의 스타일 중시"] },
  4: { leftLabel: "4w3", rightLabel: "4w5", left: ["감정을 솔직히 표현하며 목표지향", "개성을 사회적 맥락에서 드러냄", "독창성으로 주목받고 싶음", "감정 몰입과 성취욕구 공존", "관계 속에서 매력 발휘"], right: ["내면에 몰입, 사색적·독창적", "감정을 섬세하게 분석/표현", "자기이해와 탐구를 중시", "성찰/창작에 집중", "감정과 사고의 조화"] },
  5: { leftLabel: "5w4", rightLabel: "5w6", left: ["깊이 있는 사고 + 창의성", "감정 몰입과 지적 탐구 공존", "독립적이고 자율적", "복잡한 문제를 분석/탐구", "지적·예술적 관심을 동시에 가짐"], right: ["분석적이고 신중, 계획적", "현실적 문제 해결력", "불확실성에 대비책 마련", "정보 습득과 안전망 중시", "논리와 안정의 균형"] },
  6: { leftLabel: "6w5", rightLabel: "6w7", left: ["신중하고 분석적, 전략적 사고", "불확실성에 대비/계획 중시", "안전/신뢰에 민감", "지식과 정보로 판단", "조직적·논리적 접근"], right: ["외향적/활동적이며 연결을 원함", "사회적 관계 속 안정/즐거움", "신뢰할 집단에서 에너지 발휘", "계획적이지만 모험성도 있음", "협력하며 문제 해결"] },
  7: { leftLabel: "7w6", rightLabel: "7w8", left: ["외향적/사교적, 연결을 즐김", "즐거움/경험 추구, 활동적", "신뢰/협력 속 모험을 계획", "호기심 많고 가능성 탐색", "함께 즐거움을 나눔"], right: ["강한 추진력과 결단력", "모험적/도전적, 외향성 강조", "주도적이고 자신감 넘침", "해결책을 빠르게 탐색", "에너지와 영향력으로 리더십"] },
  8: { leftLabel: "8w7", rightLabel: "8w9", left: ["강인한 의지 + 외향적 에너지", "주도적/모험적/결단력 강함", "행동으로 문제 해결", "도전을 즐김", "리더십과 추진력"], right: ["강인함 + 온화함", "권위적이지만 조화 중시", "결단력 + 협력", "주변 보호/지킴", "내적 강인함과 온화함의 균형"] },
  9: { leftLabel: "9w8", rightLabel: "9w1", left: ["평화로우나 결단력/의지도 결합", "갈등을 피하면서 보호적", "조화 유지, 안정감과 힘 추구", "내적 평화 + 외적 강인함 공존", "주변을 안정시키는 역할"], right: ["온화함 + 원칙적 성향", "조화를 유지하고 갈등을 조심", "자기 규율과 내적 안정", "평화로운 관계 유지", "이상과 현실의 균형"] },
};

// ======================
// 📌 상세 결과(네가 준 문구 그대로)
// ======================
const wingLongDesc = {
  "1w2": `🟢 1번 유형 (개혁가)
1w2 (개혁가 + 조력가)

원칙적이고 이상주의적인 성향에 따뜻한 인간관계 지향이 더해진 모습이다.
정의감과 도덕성을 바탕으로 사회적 문제나 공동체의 필요에 적극적으로 참여한다.
사람들을 돕는 과정에서 보람과 정체성을 느끼며, 책임감이 강하다.
실천적이고 적극적이며, 자기 기준을 타인에게 적용하려는 경향이 있다.
비판적일 수 있으나, 그 의도는 타인을 더 나은 방향으로 이끌고자 함이다.
헌신과 이상주의가 결합되어 ‘봉사하는 개혁가’로 불린다.
때로는 자기 희생이 지나치거나 교정하려는 태도로 비칠 수 있다.
그러나 공동선을 위한 열정과 따뜻한 책임감이 특징이다.
타인의 성장과 사회적 변화를 동시에 추구하는 유형이다.`,

  "1w9": `🟢 1번 유형 (개혁가)
1w9 (개혁가 + 평화주의자)

원칙적이고 이상주의적인 성향에 차분하고 평화로운 기질이 더해진 모습이다.
도덕적 기준을 중시하면서도, 갈등보다는 조화와 평화를 추구한다.
외부적으로 강하게 나서기보다는 차분하고 신중하게 의견을 제시한다.
침착하고 안정적인 태도로 주변에 신뢰감을 준다.
내적 평화와 자기 수양을 중시하며, 종종 철학적·사색적이다.
이상주의가 지나쳐 현실과 괴리를 겪기도 한다.
분노를 직접 드러내기보다 억제하고 평화로움을 유지하려 한다.
‘차분한 개혁가’, ‘평화로운 원칙주의자’로 불릴 수 있다.
정의감과 온화함을 함께 품고 살아가는 유형이다.`,

  "2w1": `🟢 2번 유형 (조력가)
2w1 (조력가 + 개혁가)

따뜻하고 배려심 많은 조력 성향에 원칙적이고 책임감 있는 기질이 결합된 모습이다.
타인을 돕고 싶어 하면서도 도덕적·윤리적 기준에 충실하다.
사람들에게 헌신적이면서도, 자신의 도움을 올바른 방식으로 주고자 한다.
겸손하면서도 강한 책임감을 보여 공동체에 크게 기여한다.
자기희생적일 수 있으나, 동시에 올바름을 지향한다.
타인의 성장을 돕고, 정의로운 질서를 유지하려 한다.
때로는 지나치게 자신을 억제하거나 엄격해질 수 있다.
‘헌신적인 도덕가’로 불리며 안정감을 준다.
따뜻함과 원칙 사이의 균형을 이루려는 유형이다.`,

  "2w3": `🟢 2번 유형 (조력가)
2w3 (조력가 + 성취가)

유형은 따뜻한 조력 성향에 성취욕과 사회적 매력이 결합된 모습이다.
타인을 돕는 것에서 기쁨을 느끼지만, 동시에 인정받고 싶어 한다.
매력적이고 사교적이며, 활발한 관계를 만들어 나간다.
사람들에게 친근하면서도 성과 지향적인 태도를 보인다.
다른 사람의 욕구를 민감하게 파악하고 적극적으로 지원한다.
때로는 인정 욕구 때문에 지나치게 과장되거나 피상적일 수 있다.
‘매력적인 조력자’로 불리며 사회적 영향력이 크다.
돕는 행동이 개인적 성공과도 연결된다.
따뜻함과 성취욕을 동시에 추구하는 유형이다.`,

  "3w2": `🟢 3번 유형 (성취가)
3w2 (성취가 + 조력가)

유형은 성취욕과 목표 지향적 성향에 사교성과 따뜻함이 결합된 모습이다.
다른 사람에게 호감을 주면서도 뛰어난 성과를 추구한다.
리더십이 강하며, 사람들을 이끄는 능력이 있다.
인정받는 데 민감하고, 사회적으로 성공하는 것을 중시한다.
카리스마와 매력으로 대인관계에서 유리하다.
때로는 이미지 관리에 치중하여 진정성이 부족해 보일 수 있다.
‘매력적인 성취가’로 불리며 사람들을 끌어당긴다.
성과와 관계를 동시에 추구한다.
외향적이고 자신감 넘치는 유형이다.`,

  "3w4": `🟢 3번 유형 (성취가)
3w4 (성취가 + 개인주의자)

유형은 성취욕과 목표 지향적 성향에 개성과 창의성이 더해진 모습이다.
자신의 독창성을 성과로 연결하려 한다.
보다 진지하고 내면적인 성찰을 중시한다.
자신의 특별함을 인정받고 싶어 하며, 개성적인 성취를 추구한다.
사람들 앞에서는 성공적인 이미지를 보이되, 내면적으로는 깊이 있는 자기표현을 원한다.
때로는 감정 기복이 심하거나 완벽주의적일 수 있다.
‘창의적인 성취가’로 불린다.
성과와 자기 정체성을 동시에 추구한다.
외향성과 내향성이 균형을 이루는 유형이다.`,

  "4w3": `🟢 4번 유형 (개인주의자)
4w3 (개인주의자 + 성취가)

유형은 감수성과 창의성에 외향성과 성취욕이 더해진 모습이다.
자신의 독창성을 표현하고, 예술적·창조적 성취를 추구한다.
사람들 앞에서 매력적이고 표현력이 풍부하다.
자기 개성을 인정받을 때 가장 만족한다.
때로는 과시적이거나 극적일 수 있다.
예술적 재능과 사회적 카리스마를 동시에 지닌다.
‘극적인 예술가’로 불리기도 한다.
자신의 내면과 외부 성과를 함께 추구한다.
표현력과 창의성이 강한 유형이다.`,

  "4w5": `🟢 4번 유형 (개인주의자)
4w5 (개인주의자 + 탐구가)

감수성과 창의성에 사색적이고 탐구적인 기질이 결합된 모습이다.
내향적이고 철학적이며, 깊은 내면세계를 탐구한다.
예술적 재능과 지적 호기심을 함께 지닌다.
자신의 독특함을 지식과 사유를 통해 표현한다.
때로는 고독하거나 현실에서 벗어난 태도를 보이기도 한다.
‘사색적인 예술가’로 불린다.
풍부한 감성과 깊한 사고를 동시에 추구한다.
개성적이면서도 철저히 자기 내면 중심적이다.
지적 탐구와 예술적 표현이 어우러지는 유형이다.`,

  "5w4": `🟢 5번 유형 (탐구가)
5w4 (탐구가 + 개인주의자)
지적 탐구심과 독창적 감수성이 결합된 모습이다.
내향적이고 예술적이며, 독립적인 사고를 중시한다.
깊은 이해와 통찰을 지향한다.
학문과 예술, 철학을 아우르는 관심을 가질 수 있다.
때로는 고립되거나 현실과 거리감을 둘 수 있다.
‘철학적인 탐구가’로 불린다.
창의성과 분석력이 함께 발휘된다.
사유와 자기 표현을 동시에 추구한다.
깊은 내적 세계를 탐구하는 유형이다.`,

  "5w6": `🟢 5번 유형 (탐구가)
5w6 (탐구가 + 충실가)

지적 탐구심과 안전 추구적 성향이 결합된 모습이다.
논리적이고 분석적이며, 신뢰할 만한 사람을 찾는다.
불안정한 상황을 피하고 확실한 지식을 추구한다.
실용적이고 체계적인 사고를 한다.
때로는 의심이 많거나 지나치게 신중할 수 있다.
‘실용적인 탐구가’로 불린다.
안정성과 지식을 동시에 추구한다.
협력적이면서도 분석적인 태도를 보인다.
현실적이고 신뢰성 있는 유형이다.`,

  "6w5": `🟢 6번 유형 (충실가)
6w5 (충실가 + 탐구가)

충실성과 신뢰를 중시하면서 분석적이고 신중한 기질을 보인다.
불확실한 상황을 대비하고, 안전을 위해 정보를 수집한다.
신뢰할 만한 관계와 체계를 찾는다.
때로는 방어적이거나 의심이 많을 수 있다.
‘분석적인 충실가’로 불린다.
사려 깊고 조심스럽다.
협력과 안정성을 추구한다.
자신과 타인의 안전을 지키려는 태도가 강하다.
책임감 있는 현실주의적 유형이다.`,

  "6w7": `🟢 6번 유형 (충실가)
6w7 (충실가 + 열정가)

충실성과 신뢰 성향에 사교적이고 활동적인 기질이 결합된 모습이다.
사람들과 함께할 때 안전감을 느낀다.
낙관적이고 활발하며, 새로운 활동에 참여한다.
불안할 때는 사람들과의 관계를 통해 위안을 얻는다.
때로는 충동적이거나 의존적일 수 있다.
‘사교적인 충실가’로 불린다.
협력과 모험심을 동시에 추구한다.
대인관계와 공동체 중심적이다.
밝고 활동적인 현실주의자다.`,

  "7w6": `🟢 7번 유형 (열정가)
7w6 (열정가 + 충실가)

모험심과 낙관주의에 충실성과 사회성이 결합된 모습이다.
사람들과 함께하는 활동에서 즐거움을 찾는다.
안정과 안전을 확보하면서도 다양한 경험을 즐긴다.
낙관적이지만 동시에 신뢰할 수 있는 사람을 찾는다.
때로는 산만하거나 지나치게 의존적일 수 있다.
‘협력적인 모험가’로 불린다.
재미와 안전을 동시에 추구한다.
사회적이고 활발한 유형이다.
밝고 친근한 성격이 특징이다.`,

  "7w8": `🟢 7번 유형 (열정가)
7w8 (열정가 + 도전자)

모험심과 낙관주의에 강인함과 자기주장이 결합된 모습이다.
자유롭고 독립적인 기질이 강하다.
모험을 두려워하지 않고, 적극적으로 새로운 경험을 추구한다.
리더십을 발휘하며, 대담하게 나아간다.
때로는 충동적이거나 지배적일 수 있다.
‘대담한 모험가’로 불린다.
재미와 힘을 동시에 추구한다.
자유롭고 에너지 넘치는 성격이 특징이다.
강렬한 카리스마가 있다.`,

  "8w7": `🟢 8번 유형 (도전자)
8w7 (도전자 + 열정가)

강인함과 자기주장에 외향적이고 모험적인 기질이 결합된 모습이다.
에너지 넘치고 카리스마가 강하다.
사람들을 이끌고 주도하는 능력이 있다.
위험을 두려워하지 않고, 대담하게 행동한다.
때로는 과격하거나 지배적으로 보일 수 있다.
‘카리스마 있는 도전자’로 불린다.
힘과 자유를 동시에 추구한다.
외향적이고 활동적인 성격이 특징이다.
강력한 리더십을 보인다.`,

  "8w9": `🟢 8번 유형 (도전자)
8w9 (도전자 + 평화주의자)

강인함과 자기주장에 차분하고 평화로운 기질이 결합된 모습이다.
강하면서도 온화한 태도를 보인다.
타인을 보호하고, 공동체의 평화를 중시한다.
리더십이 있지만, 과격함보다는 부드러운 힘을 발휘한다.
때로는 소극적이거나 갈등을 피하려 할 수 있다.
‘보호적인 도전자’로 불린다.
힘과 조화를 동시에 추구한다.
차분하면서도 강인한 성격이 특징이다.
따뜻한 리더십을 보인다.`,

  "9w8": `🟢 9번 유형 (평화주의자)
9w8 (평화주의자 + 도전자)

온화하고 평화로운 성향에 강인함과 자기주장이 결합된 모습이다.
기본적으로 갈등을 피하려 하지만, 필요할 때는 단호하다.
타인을 보호하며, 중재자의 역할을 한다.
온화하지만 강력한 존재감을 발휘한다.
때로는 수동적 공격성을 보일 수 있다.
‘강인한 평화주의자’로 불린다.
조화와 힘을 동시에 추구한다.
부드러우면서도 단단한 성격이 특징이다.
균형 잡힌 리더십을 발휘한다.`,

  "9w1": `🟢 9번 유형 (평화주의자)
9w1 (평화주의자 + 개혁가)

온화하고 평화로운 성향에 원칙적이고 이상주의적 기질이 결합된 모습이다.
갈등을 피하려 하지만, 정의와 도덕적 기준은 중시한다.
차분하고 사려 깊으며, 안정감을 준다.
사람들을 중재하고, 올바른 길로 이끌려 한다.
때로는 자기 주장이 약하거나 현실 회피적일 수 있다.
‘도덕적인 평화주의자’로 불린다.
평화와 원칙을 동시에 추구한다.
온화하면서도 이상주의적 성격이 특징이다.
균형 있는 중재자로서의 힘을 발휘한다.`,
};

// 상세 결과 메시지 조립
function buildResultMessage(typeNum, wingLabel) {
  const header = `✨ 결과: ${wingLabel} (기본 타입 ${typeNum})`;
  const detail = wingLongDesc[wingLabel] || "";
  return `${header}\n\n${detail}\n\n${questions.save}`;
}

// ======================
// 📌 세션 관리
// ======================
let sessions = {};
function resetToStart(userId) {
  sessions[userId] = {
    step: "start",
    Name: null,
    answers: {},
    Basic_Type: null,
    Wing: null,
  };
  return sessions[userId];
}

// ======================
// 📌 질문 텍스트
// ======================
const questions = {
  menu: "1️⃣ 지금까지 결과 보기\n2️⃣ 테스트하기\n\n원하는 번호를 선택하세요!",
  askName: "이름을 입력해주세요 🙂",
  Q1_1: "Q1-1. 집단에서 관계를 맺을 때 나는…\n1. 규칙과 질서를 중시하며 상대가 기대하는 역할을 수행하려고 한다.\n2. 자신감 있게 주도하고, 필요한 경우 솔직하게 의견을 말하려고 한다.\n3. 타인의 감정과 분위기에 민감하여 상황을 조율하려고 한다.",
  Q1_2: "Q1-2. 사람들과 함께 있을 때 나는…\n1. 신뢰와 안정감을 중요하게 여기며, 일관성을 유지하려고 한다.\n2. 자신이 중심이 되어 일을 이끌거나 새로운 기회를 찾으려 한다.\n3. 주변 사람의 마음과 필요를 읽고 조화를 맞추려고 한다.",
  Q2_1: "Q2-1. 일이 계획대로 되지 않을 때 나는…\n1. “그래도 괜찮아, 이 상황에서도 배울 점이 있어”라고 스스로를 다독하며 마음을 편하게 한다.\n2. “문제를 차근차근 해결해야 해”라며 감정을 잠시 억누르고 계획을 세운다.\n3. “왜 이렇게 일이 꼬이지?”라며 순간적으로 답답함, 화, 불안 등을 깊이 느끼고 마음속으로 곱씹는다.",

  save: "결과를 저장하시겠습니까?\n1) 저장하기\n2) 저장 안 하기",
};// Q3 질문 & 선택지
const Q3 = {
  question: "Q3. 아래 상황에서 나의 모습과 가장 가까운 선택지를 순서대로 3개 고르세요.\n(예: 1 5 9)",
  options: [
    "1️⃣\n완벽을 추구하고 옳고 그름에 민감한 특징의 사람입니다.\n스트레스 상황에서는 내적 불안과 자기 비판이 강해지고 감정이 격화합니다.\n안정적일 때는 활기차고 즐거움을 추구하며 융통성을 발휘합니다.",
    "2️⃣\n타인을 돕고 인정받기를 중시하며 관계 중심적인 특징의 사람입니다.\n스트레스 상황에서는 통제적이고 공격적이며 과도한 행동이 나타납니다.\n안정적일 때는 감정을 이해하며 관계를 세심하게 살핉니다.",
    "3️⃣\n목표 지향적이고 효율성을 중시하는 특징의 사람입니다.\n스트레스 상황에서는 갈등을 회피하고 우유부단하며 조화를 지나치게 추구합니다.\n안정적일 때는 계획적이고 신중하며 팀과 협력하려는 모습이 나타납니다.",
    "4️⃣\n감정과 개성을 중요시하며 독창적인 특징의 사람입니다.\n스트레스 상황에서는 감정에 몰입하고 자기 표현이 과도해집니다.\n안정적일 때는 질서 있게 행동하고 내적 규범을 지키며 창의성을 발휘합니다.",
    "5️⃣\n분석적이고 정보 수집을 중시하며 지적 호기심이 강한 특징의 사람입니다.\n스트레스 상황에서는 회피적이고 고립되며 관찰에 치중합니다.\n안정적일 때는 계획적이고 효율적으로 문제를 분석합니다.",
    "6️⃣\n충성심이 강하고 신뢰와 안전을 중시하는 특징의 사람입니다.\n스트레스 상황에서는 과도하게 불안해하며 의심과 걱정이 커지고, 반복적으로 확인하거나 안전을 점검하려는 행동이 나타납니다.\n안정적일 때는 평화롭고 조화롭게 상황을 조율합니다.",
    "7️⃣\n활기차고 낙천적이며 새로운 경험과 가능성을 추구하는 특징의 사람입니다.\n스트레스 상황에서는 충동적이고 산만하며 계획을 무시하는 경향이 나타납니다.\n안정적일 때는 차분하게 분석하고 효율적으로 문제를 해결합니다.",
    "8️⃣\n강력한 통제력과 리더십을 발휘하며 주도적인 특징의 사람입니다.\n스트레스 상황에서는 지나치게 고립되고 과도하게 분석적으로 행동합니다.\n안정적일 때는 단호하게 행동하면서도 타인을 돕고 관계를 조율합니다.",
    "9️⃣\n평화롭고 온화하며 조화를 중시하고 상황을 수용하는 특징의 사람입니다.\n스트레스 상황에서는 갈등이나 요구 앞에서 과도하게 소극적이고 회피하며, 자신의 의견을 내지 못하는 모습이 나타납니다.\n안정적일 때는 목표 달성 의식과 효율적 행동을 보입니다."
  ]
};

// ======================
// 📌 메시지 처리
// ======================
app.post("/message", (req, res) => {
  const userId = req.body.userId || "default";
  const msg = (req.body.message || "").toString().trim();

  if (!isCSVReady) {
    return res.json({ reply: "⏳ CSV 로드 중입니다. 잠시 후 다시 시도해주세요.\n\n" + questions.menu });
  }

  if (!sessions[userId]) resetToStart(userId);
  let session = sessions[userId];

  if (msg.includes("테스트")) {
    resetToStart(userId);
    return res.json({ reply: questions.menu });
  }

  if (session.step === "start") {
    if (msg === "1") {
      db.all("SELECT name, basic_type, wing FROM results", [], (err, rows) => {
        if (err) return res.json({ reply: "❌ DB 조회 오류" });
        if (rows.length === 0) return res.json({ reply: "아직 저장된 결과가 없습니다.\n\n" + questions.menu });
        const lines = rows.map((r) => `${r.name}: ${r.wing} (기본 타입 ${r.basic_type})`).join("\n");
        return res.json({ reply: "📊 지금까지 결과:\n" + lines + "\n\n" + questions.menu });
      });
      return;
    } else if (msg === "2") {
      session.step = "askName";
      return res.json({ reply: questions.askName });
    } else {
      return res.json({ reply: questions.menu });
    }
  }

  if (session.step === "askName") {
    session.Name = msg;
    session.step = "Q1_1";
    return res.json({ reply: questions.Q1_1 });
  }

  if (session.step === "Q1_1") {
    session.answers.Q1_1 = normalize13(msg);
    session.step = "Q1_2";
    return res.json({ reply: questions.Q1_2 });
  }

  if (session.step === "Q1_2") {
    session.answers.Q1_2 = normalize13(msg);
    session.step = "Q2_1";
    return res.json({ reply: questions.Q2_1 });
  }

  if (session.step === "Q2_1") {
    session.answers.Q2_1 = normalize13(msg);
    session.step = "Q3";
    return res.json({ reply: Q3.question + "\n\n" + Q3.options.join("\n\n") });
  }

  if (session.step === "Q3") {
    const picks = msg.match(/[1-9]/g);
    if (!picks || picks.length < 3) {
      return res.json({
  reply:
    "3개 숫자를 순서대로 입력해주세요. (예: 1 5 9)\n\n" +
    Q3.question + "\n\n" + Q3.options.join("\n\n")
});
    }
    const q3 = picks.slice(0, 3).join("-");
    session.answers.Q3 = q3;

    const key = keyOf(session.answers.Q1_1, session.answers.Q1_2, session.answers.Q2_1, q3);
    const found = indexMap.get(key);

    if (!found || found.length === 0) {
      return res.json({ reply: "❌ 조합을 찾을 수 없습니다. 다시 시도해주세요.\n\n" + questions.menu });
    }

    // 여러 행이 있어도 첫 번째만 사용
    session.Basic_Type = found[0].type;
    session.step = "Wing";
    return res.json({ reply: buildWingQuestion(session.Basic_Type) });
  }

  if (session.step === "Wing") {
    if (msg === "1") {
      session.Wing = wingDesc[Number(session.Basic_Type)].leftLabel;
    } else if (msg === "2") {
      session.Wing = wingDesc[Number(session.Basic_Type)].rightLabel;
    } else {
      return res.json({ reply: "1 또는 2로 선택해주세요.\n" + buildWingQuestion(session.Basic_Type) });
    }
    session.step = "save";

    // 상세 설명까지 붙여서 결과 출력
    return res.json({ reply: buildResultMessage(session.Basic_Type, session.Wing) });
  }

  if (session.step === "save") {
    if (msg === "1") {
      db.run(
        "INSERT INTO results (userId, name, basic_type, wing) VALUES (?, ?, ?, ?)",
        [userId, session.Name, session.Basic_Type, session.Wing],
        (err) => {
          if (err) {
            console.error("❌ DB 저장 오류:", err.message);
            return res.json({ reply: "❌ DB 저장 오류" });
          }
          resetToStart(userId);
          return res.json({ reply: "✅ 저장되었습니다!\n\n" + questions.menu });
        }
      );
      return;
    } else if (msg === "2") {
      resetToStart(userId);
      return res.json({ reply: "저장을 건너뛰었습니다.\n\n" + questions.menu });
    } else {
      return res.json({ reply: questions.save });
    }
  }

  // 그 외
  return res.json({ reply: questions.menu });
});

// ======================
// 📌 날개 선택 질문 출력
// ======================
function buildWingQuestion(typeNum) {
  const wing = wingDesc[typeNum];
  if (!wing) return "❌ 잘못된 타입입니다.";

  return `당신의 기본 유형은 ${typeNum}번입니다.\n\n날개를 선택하세요:\n1) ${wing.leftLabel}\n   - ${wing.left.join("\n   - ")}\n\n2) ${wing.rightLabel}\n   - ${wing.right.join("\n   - ")}`;
}

// ======================
// 📌 서버 실행
// ======================
app.listen(PORT, () => {
  app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
});  