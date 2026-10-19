// Help / work instruction (Thai + English) with annotated screenshots in help/<lang>/.
"use strict";
window.PM = window.PM || {};
PM.help = (() => {
  const fig = (lang, img, title, items) => `
    <figure class="wi-fig">
      <img src="help/${lang}/${img}.jpg" alt="${title}" loading="lazy">
      <figcaption><b>${title}</b>${items && items.length ? `<ol class="wi-legend">${items.map(t => `<li>${t}</li>`).join("")}</ol>` : ""}</figcaption>
    </figure>`;
  const step = (n, title, body) => `<div class="wi-step"><div class="wi-n">${n}</div><div class="wi-body"><h3>${title}</h3>${body}</div></div>`;

  // ------------------------------------------------------------------ THAI
  function th() {
    const L = "th";
    return `
<div class="wi-head">
  <div><h1>คู่มือการทำงาน (Work Instruction) — โปรแกรมวัดขนาดจากภาพถ่าย</h1>
  <div class="muted">เวอร์ชัน 0.6.0 · เปิดไฟล์ index.html ด้วย Chrome หรือ Edge (ไม่ต้องติดตั้ง) · ใช้กล้องอุตสาหกรรม: เปิดผ่าน Camera Bridge (หัวข้อ 9)</div></div>
  <button class="btn primary no-print" onclick="window.print()">🖨 พิมพ์ / บันทึกเป็น PDF</button>
</div>

<div class="card wi-toc no-print"><b>สารบัญ</b>
  <ol>
    <li><a href="#wi-flow">ภาพรวมขั้นตอนการทำงาน</a></li>
    <li><a href="#wi-login">เข้าสู่ระบบ</a></li>
    <li><a href="#wi-prog">ผู้ดูแลระบบ: สร้างโปรแกรมการวัด</a></li>
    <li><a href="#wi-meas">ผู้ปฏิบัติงาน: วัดภาพถ่าย</a></li>
    <li><a href="#wi-err">เมื่อผลวัดขึ้น ERR</a></li>
    <li><a href="#wi-rep">ออกรายงาน</a></li>
    <li><a href="#wi-photo">วิธีถ่ายภาพที่ถูกต้อง</a></li>
    <li><a href="#wi-trouble">ปัญหาที่พบบ่อยและวิธีแก้</a></li>
    <li><a href="#wi-cam">กล้องอุตสาหกรรม (Camera Bridge)</a></li>
    <li><a href="#wi-cal">สอบเทียบสถานี (ไม่ใช้รู REF)</a></li>
    <li><a href="#wi-time">เวลาประมวลผล</a></li>
    <li><a href="#wi-train">สอนตัวอ่านตัวอักษรเอง (Training)</a></li>
  </ol>
</div>

<h2 id="wi-flow">1. ภาพรวมขั้นตอนการทำงาน</h2>
<div class="wi-flow">
  <div class="wi-box admin">ผู้ดูแลระบบ (Admin)<br><small>สร้างโปรแกรมการวัดจากภาพต้นแบบ แล้วบันทึกลงคลัง</small></div><span>➜</span>
  <div class="wi-box">ผู้ปฏิบัติงาน (Operator)<br><small>เลือกโปรแกรม → เพิ่มภาพถ่าย</small></div><span>➜</span>
  <div class="wi-box">ตรวจผล OK / NG<br><small>แก้ไขรายการที่ขึ้น ERR</small></div><span>➜</span>
  <div class="wi-box">ออกรายงาน<br><small>Excel · PDF · Word · CSV</small></div>
</div>
<p>หลักการ: บนชิ้นงานมี <b>รูอ้างอิง (REF1, REF2)</b> ที่รู้ขนาดจริง โปรแกรมใช้รูนี้หามาตราส่วน (มม./พิกเซล) ตำแหน่ง และมุมของชิ้นงานในทุกภาพ จึงถ่ายภาพได้โดยไม่ต้องมีจิ๊กจับ แล้ววัดทุกจุดที่กำหนดในโปรแกรมให้อัตโนมัติ</p>

<h2 id="wi-login">2. เข้าสู่ระบบ</h2>
${step(1, "เปิดโปรแกรมครั้งแรก: สร้างบัญชีผู้ดูแลระบบ", `<p>ดับเบิลคลิกไฟล์ <b>index.html</b> ครั้งแรกจะขึ้นหน้าสร้างบัญชีผู้ดูแลระบบ (Admin) ครั้งต่อไปให้เลือกชื่อผู้ใช้และใส่รหัสผ่าน</p>
${fig(L, "01_login", "หน้าจอเข้าสู่ระบบ", ["ชื่อผู้ดูแลระบบ (ครั้งต่อไปจะเป็นรายการเลือกชื่อผู้ใช้)", "รหัสผ่าน (อย่างน้อย 4 ตัวอักษร)", "ยืนยันรหัสผ่าน (เฉพาะครั้งแรก)", "กดเพื่อสร้างบัญชีและเข้าสู่ระบบ"])}
<p class="note">ผู้ปฏิบัติงาน (Operator) จะเห็นเฉพาะแท็บ <b>วัดภาพถ่าย</b>, <b>รายงาน</b> และ <b>วิธีใช้</b> ไม่สามารถแก้ไขโปรแกรมการวัดได้</p>`)}

<h2 id="wi-prog">3. ผู้ดูแลระบบ: สร้างโปรแกรมการวัด</h2>
${step(1, "โหลดภาพต้นแบบและเลือกรูอ้างอิง", `<p>ใช้ภาพที่คมชัด ถ่ายตรงจากด้านบน จากนั้นคลิกเลือกรูอ้างอิง วงกลมสีเหลืองคือรูที่โปรแกรมหาเจอ</p>
${fig(L, "02_master", "แท็บ 1 · โปรแกรมการวัด", ["<b>โหลดภาพต้นแบบ</b>", "เครื่องมือ <b>◎ REF1</b>", "คลิกภายในรูอ้างอิงที่ 1 (จุดกำเนิดพิกัด)", "เครื่องมือ <b>◎ REF2</b>", "คลิกภายในรูอ้างอิงที่ 2 (ทิศแกน X)"])}`)}
${step(2, "ตั้งค่าการอ้างอิง", `${fig(L, "03_refs", "ชิ้นงานและวงกลมอ้างอิง", ["<b>การอ้างอิง</b>: วงกลม 2 วง (แม่นยำที่สุด) หรือ วงกลม 1 วง", "<b>อ้างอิงการหมุนจาก</b>: ทิศ REF1→REF2, เส้นขอบ/จุดที่วัด, การเทียบภาพกับต้นแบบ หรือไม่หมุน (กรณีใช้จิ๊ก)", "ขนาดรู REF1 จริงจากแบบ (มม.)", "ขนาดรู REF2 จริงจากแบบ (มม.)", "ผลมาตราส่วน (พิกเซล/มม.) และค่าตรวจสอบ ควรต่ำกว่า 3 %"])}
<p class="note">ควรมีอย่างน้อย <b>20 พิกเซล/มม.</b> ถ้าน้อยกว่า ให้ถ่ายภาพใกล้ขึ้นหรือใช้เลนส์ซูม 2×</p>`)}
${step(3, "วางเครื่องมือวัดบนภาพต้นแบบ", `${fig(L, "04_tools", "แถบเครื่องมือ", ["<b>Circle (วงกลม)</b>: ลากจากจุดศูนย์กลางไปที่ขอบ → เส้นผ่านศูนย์กลาง, ความกลม", "<b>Arc (ส่วนโค้ง)</b>: คลิก 3 จุดบนส่วนโค้ง", "<b>Line (เส้น)</b>: ลากไปตามขอบ ลูกศรคือทิศการค้นหาขอบ", "<b>Edge point (จุดขอบ)</b>: ลากข้ามขอบ", "<b>Colour point (จุดตรวจสี)</b>: ลากจากกลางจุดสีไปที่ขอบ สีบนต้นแบบจะถูกสอนเป็นค่ามาตรฐาน", "<b>2D code area</b>: ลากจากกลาง DataMatrix ไปที่มุม → อ่านหมายเลขซีเรียล", "<b>Text (OCR)</b>: ลากกรอบรอบข้อความ 1 บรรทัด → อ่านตัวอักษร", "<b>Report area</b>: ลากกรอบรอบชิ้นงาน → ภาพในรายงานและใช้เทียบกับต้นแบบ"])}
<p>เครื่องมือที่สร้างจากองค์ประกอบอื่น (การ์ด <b>สร้างจากองค์ประกอบ</b>): จุดกึ่งกลาง, จุดตัดของ 2 เส้น, จุดฉาก, เส้นผ่าน 2 จุด, วงกลมผ่าน 3 จุด, เส้นขนาน, เส้นตั้งฉาก, เส้นแบ่งครึ่งมุม</p>`)}
${step(4, "ปรับพื้นที่ค้นหาและการหาขอบ", `<p>คลิกเลือกเครื่องมือ (บนภาพหรือในตาราง <b>องค์ประกอบ</b>) แล้วลากจุดจับเพื่อย้ายหรือปรับขนาด</p>
${fig(L, "05_props", "คุณสมบัติของเครื่องมือ", ["จุดจับ ● ย้ายพื้นที่ค้นหา", "จุดจับ ■ ปรับขนาด (รัศมี/ความกว้างแถบค้นหา)", "<b>Edge polarity</b>: มืด→สว่าง, สว่าง→มืด หรือ any", "<b>Threshold</b>: ค่าความต่างของความสว่างขั้นต่ำที่ถือว่าเป็นขอบ (ค่าน้อย = หาขอบง่ายขึ้น)", "<b>Redraw area</b>: วาดพื้นที่ค้นหาใหม่"])}
<p class="note">เส้นสีเขียว = วัดได้, จุดสีเหลือง = จุดขอบที่ตรวจพบ, เส้นประ = พื้นที่ค้นหา</p>`)}
${step(5, "อ่านข้อความ (OCR)", `${fig(L, "06_ocr", "ข้อความ (OCR)", ["กรอบข้อความบนภาพ", "<b>Format</b>: A = ตัวอักษร, 9 = ตัวเลข, X = อย่างใดอย่างหนึ่ง, ? = อะไรก็ได้ เช่น AAA9 สำหรับ DZZ0 ช่วยแก้ตัวที่คล้ายกัน (0/O, 2/Z, 5/S, 8/B)", "ภาพที่โปรแกรมใช้อ่าน และผลที่อ่านได้พร้อม % ความมั่นใจ", "<b>Read again</b>: อ่านใหม่หลังเปลี่ยนการตั้งค่า"])}
<p>ถ้าตัวอักษรตั้งแนวดิ่ง ให้เลือก <b>Text direction</b> 90°/180°/270° · ข้อความต้องสูงอย่างน้อยประมาณ 20 พิกเซลในภาพ · อ่านได้เฉพาะตัวอักษรภาษาอังกฤษและตัวเลข</p>`)}
${step(6, "กำหนดรายการวัดและข้อกำหนด", `${fig(L, "07_dims", "ขนาดและพิกัดความเผื่อ", ["ประเภท: ระยะห่าง, X/Y, เส้นผ่านศูนย์กลาง, รัศมี, มุม, พื้นที่, ความกลม, ความตรง, ความขนาน, ความตั้งฉาก, ตำแหน่ง, ความร่วมศูนย์, สี ΔE, ข้อความ", "เลือกองค์ประกอบ A (และ B)", "<b>+ Add</b> เพิ่มรายการ ค่าออกแบบจะดึงจากภาพต้นแบบให้อัตโนมัติ", "<b>ข้อกำหนด</b> ของค่าตัวเลข (ตัวอย่าง: ช่วง min … max)", "ข้อกำหนดของข้อความ เช่น = {DM:0-4} คือ ต้องตรงกับ 4 ตัวแรกของรหัส 2D"])}
<table class="tbl wi-tbl"><tr><th>ข้อกำหนด</th><th>ตัวอย่าง</th><th>ผ่าน (OK) เมื่อ</th></tr>
<tr><td>ค่าออกแบบ ± พิกัด</td><td>2.900 +0.05/−0.05</td><td>อยู่ในพิกัด</td></tr>
<tr><td>ช่วง min … max</td><td>2.85 … 2.95</td><td>min ≤ ค่า ≤ max</td></tr>
<tr><td>&gt; · &lt; · ≥ · ≤</td><td>≥ 6.95</td><td>เป็นจริงตามเงื่อนไข</td></tr>
<tr><td>= · ≠ (± eps)</td><td>= 4 ±0.01</td><td>เท่ากัน / ไม่เท่ากัน ภายใน eps</td></tr>
<tr><td>ข้อความ: = · ≠ · มีคำว่า · ขึ้นต้น · ลงท้าย · regex · ตรงรูปแบบ</td><td>= {DM:0-4}</td><td>ข้อความตรงตามเงื่อนไข</td></tr>
<tr><td>สี ΔE</td><td>0 … 5</td><td>ต่ำกว่า 2 แทบมองไม่เห็นความต่าง, มากกว่า 10 ต่างชัดเจน</td></tr></table>`)}
${step(7, "ปรับการประมวลผลภาพ (เมื่อจำเป็น)", `${fig(L, "08_proc", "การประมวลผลภาพ", ["ช่องสี (เทา/แดง/เขียว/น้ำเงิน/ความอิ่มสี) เลือกช่องที่ชิ้นงานต่างจากพื้นหลังมากที่สุด", "ความสว่าง คอนทราสต์ แกมมา", "<b>Match brightness to master</b>: ปรับความสว่างของภาพให้เท่ากับต้นแบบก่อนหาขอบ", "ค่าการหาวงกลม (ใช้เมื่อหารูอ้างอิงไม่เจอ)", "<b>ภาพหลังประมวลผล</b>: ดูภาพที่โปรแกรมใช้หาขอบจริง"])}`)}
${step(8, "บันทึกลงคลังโปรแกรม", `${fig(L, "09_library", "คลังโปรแกรม", ["<b>บันทึกลงคลัง</b>: ผู้ปฏิบัติงานจะเลือกโปรแกรมนี้ได้ ทุกครั้งที่บันทึกจะเพิ่มเวอร์ชัน", "รายการโปรแกรมในคลัง (เปิด / ลบ)", "เวอร์ชัน วันที่ และผู้บันทึก", "<b>ส่งออกไฟล์</b> (.pm.json) สำรองข้อมูลหรือย้ายไปเครื่องอื่น"])}`)}
${step(9, "จัดการผู้ใช้", `${fig(L, "10_users", "แท็บ ผู้ใช้งาน", ["ชื่อผู้ใช้", "สิทธิ์: Operator (วัด/รายงาน) หรือ Admin (สร้างโปรแกรม/จัดการผู้ใช้)", "รหัสผ่าน", "<b>Add user</b>", "รายการผู้ใช้: เปลี่ยนสิทธิ์, ตั้งรหัสผ่านใหม่, ลบ"])}
<p class="note">ผู้ใช้และคลังโปรแกรมเก็บอยู่ในเบราว์เซอร์ของเครื่องนี้ ถ้าใช้เครื่องอื่นต้องสร้างผู้ใช้ใหม่และนำเข้าไฟล์โปรแกรม</p>`)}

<h2 id="wi-meas">4. ผู้ปฏิบัติงาน: วัดภาพถ่าย</h2>
${step(1, "เลือกโปรแกรมและเพิ่มภาพถ่าย", `${fig(L, "11_measure", "แท็บ 2 · วัดภาพถ่าย", ["<b>โปรแกรม</b>: เลือกโปรแกรมของชิ้นงานจากคลัง", "<b>เพิ่มภาพถ่าย…</b> เลือกได้หลายภาพพร้อมกัน (หรือลากไฟล์มาวาง)", "รายการภาพพร้อมผล OK / NG / CHECK ชื่อภาพคือหมายเลขซีเรียลจากรหัส 2D", "<b>จัดแนวแล้ว</b>: ทุกภาพหมุน/ย่อขยายให้ตรงกับต้นแบบ · <b>ภาพเดิม</b>: ภาพตามที่ถ่าย", "ข้อมูลภาพ: ซีเรียล, รหัส 2D, ข้อความ OCR, วันเวลาถ่าย, มาตราส่วน", "ผลการวัดแต่ละรายการ เทียบกับข้อกำหนด"])}
<p>ใช้ปุ่ม ◀ ▶ หรือปุ่มลูกศรบนคีย์บอร์ดเพื่อดูภาพถัดไป · ติ๊ก <b>มุมมองเดียวกันทุกภาพ</b> เพื่อดูตำแหน่งเดิมในทุกชิ้นงาน</p>`)}
${step(2, "ตรวจผลและเทียบกับภาพต้นแบบ", `${fig(L, "12_compare", "เทียบกับภาพต้นแบบ", ["ความต่างของความสว่าง คอนทราสต์ สี ขนาด (ระยะกล้อง) ความคมชัด และมุม เทียบกับต้นแบบ (สีส้ม = ต่างมาก)", "<b>ซ้อนภาพต้นแบบ</b>: เลื่อนเพื่อดูภาพต้นแบบทับภาพถ่าย ตรวจการจัดแนว", "<b>ปรับภาพ (เฉพาะภาพนี้)</b>: ความสว่าง/คอนทราสต์/แกมมา หรือ <b>Match master</b>", "ตัวอย่าง: จุดตรวจสีขึ้น NG เพราะมีคราบบนชิ้นงาน"])}
<p>ความหมายของสถานะ: <span class="pill OK">OK</span> ทุกรายการผ่าน · <span class="pill NG">NG</span> มีรายการไม่ผ่าน · <span class="pill CHECK">CHECK</span> หาองค์ประกอบไม่เจอ หรือการจัดแนวไม่น่าเชื่อถือ (ภาพเอียง ผิดชิ้นงาน ผิดรู) ต้องตรวจสอบ</p>`)}

<h2 id="wi-err">5. เมื่อผลวัดขึ้น ERR</h2>
${step(1, "กด 🔧 Fix ที่รายการ ERR", `${fig(L, "13_err", "รายการที่วัดไม่ได้", ["ปุ่ม <b>🔧 Fix</b> ข้างค่า ERR", "สถานะของภาพ"])}`)}
${step(2, "ปรับพื้นที่ค้นหา หรือใช้ Auto search", `${fig(L, "14_fix", "ปรับพื้นที่ค้นหา (เฉพาะภาพนี้)", ["โปรแกรมซูมไปที่เครื่องมือที่หาขอบไม่เจอ ลากจุดจับ ● ให้พื้นที่ค้นหาอยู่บนขอบ", "ปรับการหาขอบสำหรับภาพนี้ (polarity, choice, threshold)", "<b>Auto search</b>: ลองขยายพื้นที่และลดค่า threshold อัตโนมัติ เลือกผลที่ใกล้ต้นแบบที่สุด", "<b>Reset this photo</b>: กลับไปใช้ค่าของโปรแกรม"])}
${fig(L, "15_fixed", "ผลหลังแก้ไข", ["สถานะเปลี่ยนเป็น OK", "บันทึกว่าแก้ไขค่าเฉพาะภาพนี้ และผู้แก้ไข (แสดงในรายงานด้วย)"])}
<p class="note">ถ้าหารูอ้างอิงผิด ใช้ <b>สลับ REF1/REF2</b> หรือ <b>เลือก REF1, REF2 เอง</b> (คลิกในรูบนภาพ) · ผู้ดูแลระบบสามารถกด <b>Copy to program</b> เพื่อใช้ค่าที่แก้กับทุกภาพ</p>`)}

<h2 id="wi-rep">6. ออกรายงาน</h2>
${step(1, "เลือกรูปแบบรายงาน", `${fig(L, "16_report", "แท็บ 3 · รายงาน", ["ผู้ตรวจสอบ / บริษัท", "ภาษา: อังกฤษ, ไทย หรือทั้งสองภาษา", "ภาพที่รวมในรายงาน: ทั้งหมด, เฉพาะ NG/CHECK, เฉพาะ OK, เฉพาะภาพที่เลือก", "ค่าที่แสดง: ทุกค่า, เฉพาะ NG, เฉพาะ OK, หรือเฉพาะสรุป", "ส่งออก Excel, PDF, Word หรือ CSV"])}
${fig(L, "17_report_page", "ตัวอย่างหน้ารายงาน PDF: ข้อมูลภาพ ภาพที่วาดผลการวัด และตารางผล", [])}`)}

<h2 id="wi-photo">7. วิธีถ่ายภาพที่ถูกต้อง</h2>
${fig(L, "18_photo_tips", "ตัวอย่างภาพถ่าย", [])}
<table class="tbl wi-tbl"><tr><th>ข้อปฏิบัติ</th><th>เหตุผล</th></tr>
<tr><td>ถือโทรศัพท์ขนานกับชิ้นงาน ถ่ายตรงจากด้านบน</td><td>ถ้าเอียง วงกลมจะเป็นวงรี มาตราส่วนผิด</td></tr>
<tr><td>ให้ชิ้นงานเต็มภาพ ≥ 20 พิกเซล/มม. ใช้ซูม 2× แทนการเข้าใกล้</td><td>ความละเอียดสูงขึ้น และลดความผิดเพี้ยนของมุมมอง</td></tr>
<tr><td>พื้นหลังเรียบ สีตัดกับชิ้นงาน แสงนุ่มสม่ำเสมอ ไม่สะท้อน</td><td>หาขอบได้ชัดเจน สีไม่เพี้ยน</td></tr>
<tr><td>เห็นรูอ้างอิงครบทั้ง 2 รู และคมชัด</td><td>รูอ้างอิงใช้คำนวณมาตราส่วนของทุกภาพ</td></tr>
<tr><td>ใช้ระยะและแสงใกล้เคียงกับภาพต้นแบบ</td><td>ดูค่า <b>เทียบกับภาพต้นแบบ</b> ถ้าเป็นสีส้ม ควรถ่ายใหม่</td></tr></table>

<h2 id="wi-trouble">8. ปัญหาที่พบบ่อยและวิธีแก้</h2>
<table class="tbl wi-tbl"><tr><th>อาการ</th><th>สาเหตุที่เป็นไปได้</th><th>วิธีแก้</th></tr>
<tr><td>CHECK: “low match with master image”</td><td>ผิดชิ้นงาน ผิดโปรแกรม หรือหารูอ้างอิงผิด</td><td>ตรวจสอบโปรแกรมที่เลือก · ใช้ “เลือก REF1, REF2 เอง”</td></tr>
<tr><td>CHECK: “reference diameters disagree”</td><td>ถ่ายภาพเอียง หรือรูอ้างอิงไม่อยู่ระนาบเดียวกัน</td><td>ถ่ายใหม่ให้ตรงด้านบน</td></tr>
<tr><td>ERR ที่รายการวัด</td><td>ขอบไม่ชัด มืด หรือพื้นที่ค้นหาไม่อยู่บนขอบ</td><td>🔧 Fix → Auto search หรือลากพื้นที่ค้นหา · Match master</td></tr>
<tr><td>อ่านซีเรียล/ข้อความไม่ได้</td><td>ภาพเล็กหรือเบลอ แสงสะท้อน</td><td>ถ่ายใกล้ขึ้น · พิมพ์ซีเรียลเองในช่อง Serial</td></tr>
<tr><td>สี NG ทุกภาพ</td><td>แสงต่างจากต้นแบบ</td><td>เพิ่มจุดสีอ้างอิงสีขาว/เทา (White/gray reference) · ใช้แสงเดียวกัน</td></tr>
<tr><td>low resolution (&lt; 20 px/mm)</td><td>ถ่ายไกลเกินไป</td><td>ถ่ายใกล้ขึ้นหรือใช้ซูม 2×</td></tr></table>
<p class="muted small">ค่าที่วัดเป็นค่าประมาณจากภาพถ่ายโทรศัพท์ ไม่ใช่เครื่องมือวัดที่สอบเทียบแล้ว ควรตรวจสอบเทียบกับเครื่อง CMM/OMM ก่อนนำไปใช้ตัดสินการรับชิ้นงาน</p>
<h2 id="wi-cam">9. กล้องอุตสาหกรรม (Camera Bridge)</h2>
<p>ใช้กล้อง Basler (USB 3.0) แทนการถ่ายภาพด้วยโทรศัพท์ โปรแกรมการวัด ข้อกำหนด และรายงาน ใช้เหมือนเดิมทั้งหมด</p>
${step(1, "ติดตั้งครั้งเดียว และเปิดโปรแกรม", `<ol>
<li>ติดตั้ง <b>Basler pylon Software Suite (x64)</b> แบบ <b>Developer</b> (มี .NET API) และ <b>ASP.NET Core Runtime 8 หรือใหม่กว่า (x64)</b> จาก Microsoft</li>
<li>เสียบกล้องที่พอร์ต <b>USB 3.0</b> ของเครื่อง (ไม่ผ่าน hub) หรือสาย LAN ของกล้อง GigE และ <b>ปิด pylon Viewer / MVS</b> (กล้องใช้ได้ทีละโปรแกรม)</li>
<li>ดับเบิลคลิก <b>Start PhotoMeasure Camera.cmd</b> → เบราว์เซอร์เปิด <b>http://127.0.0.1:5090</b> (อย่าปิดหน้าต่างดำของ Camera Bridge)</li>
<li>ครั้งแรก: ข้อมูลผู้ใช้และโปรแกรมของ index.html แยกจากหน้านี้ ให้ <b>⬇ Backup</b> ที่แท็บผู้ใช้งานของ index.html แล้วกด <b>⬆ Restore a backup</b> ที่หน้าเข้าสู่ระบบ</li></ol>`)}
${step(2, "ผู้ดูแลระบบ: เชื่อมต่อกล้อง", `${fig(L, "19_cam_conn", "แท็บ 📷 กล้อง · การเชื่อมต่อ", ["แท็บ <b>📷 กล้อง</b> (แสดงเมื่อ Camera Bridge ทำงาน)", "สถานะกล้องที่หัวหน้าจอ (เขียว = เชื่อมต่อแล้ว)", "เลือกกล้อง (↻ ค้นหาใหม่)", "<b>เชื่อมต่อ</b> · ครั้งต่อไปจะเชื่อมต่อให้อัตโนมัติ และเชื่อมต่อใหม่เองถ้าสายหลุด", "ข้อมูลกล้อง: รุ่น ซีเรียล อุณหภูมิ ความเร็ว USB (ต้องเป็น SuperSpeed)", "ตั้งชื่อกล้อง เช่น Station 1"])}`)}
${step(3, "ภาพสดและการวางชิ้นงาน", `${fig(L, "20_cam_live", "ภาพสด", ["<b>▶ ภาพสด</b> เปิด/ปิด", "<b>หยุดภาพ</b> / กลับไปภาพสด", "<b>📷 ถ่ายภาพ</b> (หรือกด Space / foot switch) ภาพความละเอียดเต็มจะถูกวัดทันที", "<b>วัดทันที</b>: วัดทุกภาพที่ถ่ายด้วยโปรแกรมที่เลือก", "<b>ซ้อนภาพต้นแบบ</b> และวงกลม REF ของต้นแบบ ใช้จัดตำแหน่งชิ้นงานให้ตรงกับต้นแบบ", "แถบสถานะ: fps ขนาดภาพ exposure ความสว่างเฉลี่ย % สว่างเกิน และค่าโฟกัส"])}`)}
${step(4, "ผู้ดูแลระบบ: ตั้งค่ากล้อง", `${fig(L, "21_cam_setup", "ตั้งค่ากล้อง", ["ฮิสโตแกรม: ไม่ควรมีแท่งสีแดง (สว่างเกิน) จุดสีแดงบนภาพสดคือพิกเซลที่สว่างเกิน", "ค่าโฟกัส: หมุนเลนส์จนได้ค่าสูงสุด", "<b>Exposure time</b>: ปรับให้ภาพสว่างพอแต่ไม่สว่างเกิน (Gain ให้น้อยที่สุด เพื่อลด noise)", "<b>Auto once</b>: ให้กล้องปรับครั้งเดียวแล้วคงค่า (White balance: วางกระดาษขาวก่อน)", "<b>บันทึกลงโปรแกรม</b>: ค่ากล้องเก็บไว้ในโปรแกรมการวัด เมื่อเลือกโปรแกรมจะตั้งค่ากล้องให้อัตโนมัติ แล้วกด <b>บันทึกลงคลัง</b>", "User set: บันทึกค่าในตัวกล้อง / ค่าเริ่มต้นเมื่อเปิดกล้อง", "⬇/⬆ .pfs: สำรองหรือโหลดค่ากล้องเป็นไฟล์ (ใช้กับ pylon Viewer ได้)"])}`)}
${step(5, "ผู้ดูแลระบบ: ถ่ายภาพต้นแบบจากกล้อง", `${fig(L, "24_cam_master", "แท็บ 1 · โปรแกรมการวัด", ["<b>📷 ถ่ายภาพต้นแบบจากกล้อง</b>: ใช้ภาพจากกล้องเป็นภาพต้นแบบ ค่ากล้องจะถูกเก็บในโปรแกรมด้วย จากนั้นตั้ง REF1/REF2 และเครื่องมือวัดตามหัวข้อ 3"])}`)}
${step(6, "ผู้ปฏิบัติงาน: ถ่ายภาพและวัด", `<p>เลือกโปรแกรมที่แท็บ 2 วางชิ้นงาน แล้วกด <b>📷 ถ่ายภาพ</b> (ที่แท็บกล้องหรือแท็บวัดภาพถ่าย) หรือกด <b>Space</b></p>
${fig(L, "22_cam_result", "ผลการวัดหลังถ่ายภาพ", ["ผลรวม OK / NG พร้อมซีเรียลและเวลา รายการที่ไม่ผ่านจะแสดงใต้ผล", "ผลล่าสุด: ค่าทุกรายการ", "<b>เปิดในหน้าวัด</b>: ดูรายละเอียด แก้ไข ERR ได้เหมือนภาพถ่าย"])}
${fig(L, "25_cam_measure", "แท็บ 2 · วัดภาพถ่าย", ["<b>📷 ถ่ายภาพ</b>: ภาพจากกล้องเข้ารายการเหมือนภาพถ่าย และออกรายงานได้ตามปกติ"])}`)}
${step(7, "บันทึกภาพ", `${fig(L, "23_cam_record", "บันทึกภาพ", ["<b>💾 บันทึกภาพ</b>: บันทึกภาพที่แสดงอยู่ (หรือถ่ายใหม่)", "จำนวนภาพและช่วงเวลา สำหรับบันทึกต่อเนื่อง (ใช้ทดสอบความซ้ำของการวัด)", "<b>● บันทึกต่อเนื่อง</b> / ■ หยุด", "บันทึกอัตโนมัติหลังวัด: ทุกภาพ หรือเฉพาะ NG (ภาพ และ/หรือ ภาพผลการวัด)", "ชื่อไฟล์: {program} {serial} {status} {date} {time} {n} … และโฟลเดอร์ (แยกตามวัน)", "ภาพที่บันทึกไว้: เปิดดู หรือกด <b>วัด</b> เพื่อวัดซ้ำ"])}`)}
<table class="tbl wi-tbl"><tr><th>อาการ</th><th>สาเหตุที่เป็นไปได้</th><th>วิธีแก้</th></tr>
<tr><td>ไม่มีแท็บ 📷 กล้อง</td><td>Camera Bridge ไม่ได้เปิด</td><td>ดับเบิลคลิก Start PhotoMeasure Camera.cmd</td></tr>
<tr><td>ไม่พบกล้อง</td><td>pylon Viewer / MVS เปิดอยู่ · สาย USB / LAN · ไฟเลี้ยง</td><td>ปิด pylon Viewer / MVS · เสียบสายใหม่ที่ USB 3.0 · กล้อง GigE: ตั้ง IP ให้อยู่วงเดียวกับการ์ดแลน (ใน MVS) · กด ↻</td></tr>
<tr><td>pylon: Basler.Pylon.dll not found</td><td>ติดตั้ง pylon ไม่ครบ (.NET API)</td><td>ติดตั้ง pylon แบบ Developer · เปิด Diagnostics แล้วส่งให้ผู้ดูแล</td></tr>
<tr><td>No image from the camera (timeout)</td><td>Trigger mode = On · exposure นานมาก</td><td>ตั้ง Trigger mode = Off · ลด exposure</td></tr>
<tr><td>USB High speed (USB 2)</td><td>เสียบที่พอร์ต USB 2.0 หรือผ่าน hub</td><td>ใช้พอร์ต USB 3.0 (สีน้ำเงิน) ที่ตัวเครื่อง</td></tr></table>
<h2 id="wi-cal">10. สอบเทียบสถานี (ไม่ใช้รู REF)</h2>
<p>ใช้เมื่อกล้องติดตั้งตายตัว (ระยะกล้อง–ชิ้นงาน เลนส์ โฟกัส ไม่เปลี่ยน) และชิ้นงานไม่มีรูอ้างอิง สเกล (มม./พิกเซล) วัดครั้งเดียวด้วย <b>แผ่นสอบเทียบ</b> แล้วใช้กับทุกภาพ</p>
<div class="card"><b>ต้องเตรียม</b><ul>
<li>แผ่นสอบเทียบแบบ <b>จุดตาราง (dot grid)</b> ที่มีใบรับรองระยะห่างจุด (เช่น 0.5 หรือ 1.000 มม.) ขนาดเต็มพื้นที่ภาพ หรือ ring/pin gauge ที่ทราบ Ø (ความแม่นยำน้อยกว่า)</li>
<li>ผิวแผ่นต้องอยู่ <b>ระดับความสูงเดียวกับผิวที่วัดของชิ้นงาน</b> (ถ้าสูงต่างกัน สเกลจะต่างกัน) · กล้องตั้งฉากกับชิ้นงาน · ใช้เลนส์ telecentric ได้จะดีที่สุด</li>
<li>ห้ามเปลี่ยน โฟกัส ซูม ระยะกล้อง Binning / ขนาดภาพ หลังสอบเทียบ (ถ้าเปลี่ยน ต้องสอบเทียบใหม่)</li></ul></div>
${step(1, "ผู้ดูแลระบบ: สอบเทียบด้วยแผ่นสอบเทียบ (แท็บ 📷 กล้อง)", `${fig(L, "26_cal_plate", "การสอบเทียบสถานี", ["สถานะการสอบเทียบของกล้องนี้ (ใช้ได้ / ใกล้หมดอายุ / หมดอายุ)", "ชนิดแผ่น: Dot grid หรือ ring/pin gauge", "ระยะห่างจุด (มม.) ตามใบรับรองของแผ่น", "อายุการใช้งาน (วัน) เช่น 30", "<b>📷 ถ่ายแผ่นสอบเทียบ</b> หรือ <b>โหลดภาพแผ่น</b>", "ภาพผล: จุดสีเขียว = ดี สีส้ม/แดง = ผิดตำแหน่ง (เส้น = ทิศความคลาดเคลื่อน ขยายแล้ว)", "ผล: สเกล µm/px, X/Y, ความฉาก, ความคลาดเคลื่อนของจุด RMS/max, distortion ของเลนส์", "<b>บันทึกการสอบเทียบ</b> · <b>ตรวจเทียบกับค่าที่บันทึก</b> (ตรวจประจำวัน เกณฑ์ ±0.05 %)"])}
<p class="small">เกณฑ์แนะนำ: ความคลาดเคลื่อนจุด RMS &lt; 1/10 ของพิกัดความเผื่อที่แคบที่สุด · X/Y ต่างกัน &lt; 0.2 % · distortion &lt; 0.1 % (ถ้ามากกว่า ให้วัดชิ้นงานใกล้กลางภาพ)</p>`)}
${step(2, "ผู้ดูแลระบบ: ตั้งโปรแกรมให้ใช้การสอบเทียบสถานี", `${fig(L, "27_cal_program", "แท็บ 1 · โปรแกรมการวัด", ["การอ้างอิง = <b>Fixed calibration (station, no REF holes)</b>", "สถานี (กล้อง) ที่ใช้", "ตำแหน่งชิ้นงาน: <b>Fixture</b> (วางในจิ๊กที่เดิมทุกครั้ง เร็วที่สุด) · <b>ค้นหาตำแหน่ง</b> · <b>ค้นหาตำแหน่ง + การหมุน</b>", "ระยะค้นหา (มม.) ว่าง = ทั้งภาพ (ระยะสั้น = เร็วกว่า)", "ข้อมูลสเกลจากการสอบเทียบ และคำเตือน"])}
<ol><li>โหลด/ถ่ายภาพต้นแบบ <b>หลัง</b> สอบเทียบ (กล้องและค่าตั้งเดียวกัน) จุดเริ่มของโปรแกรม = กลางภาพ (กด ◎ REF1 เพื่อย้าย)</li>
<li>วาด <b>Report area</b> รอบชิ้นงาน: ใช้หาตำแหน่งชิ้นงานในภาพใหม่</li>
<li>ตั้ง <b>Datum</b> (จุดเริ่ม/แกน) บนรูหรือขอบของชิ้นงาน เพื่อให้ค่า X/Y เป็นของชิ้นงาน ไม่ใช่ของภาพ</li>
<li>ถ้ามีวงกลมอย่างน้อย 1 วง (และเส้น) โปรแกรมจะใช้ตำแหน่งของวงกลม/เส้นปรับตำแหน่งและมุมให้ละเอียด และตรวจขนาดชิ้นงานเทียบต้นแบบ</li></ol>`)}
${step(3, "การป้องกันผลผิด", `<table class="tbl wi-tbl"><tr><th>สถานการณ์</th><th>ผลที่ได้</th></tr>
<tr><td>ไม่มีการสอบเทียบ · ขนาดภาพ (ROI/Binning) ต่างจากตอนสอบเทียบ · ภาพจากกล้องตัวอื่น</td><td><b>FAIL</b> ไม่วัด</td></tr>
<tr><td>การสอบเทียบหมดอายุ</td><td><b>CHECK</b> พร้อมคำเตือนให้สอบเทียบใหม่</td></tr>
<tr><td>ชิ้นงานดูใหญ่/เล็กกว่าต้นแบบ (ความสูงชิ้นงาน ระยะกล้อง โฟกัส เปลี่ยน)</td><td><b>CHECK</b></td></tr>
<tr><td>ภาพไม่เหมือนต้นแบบ (ไม่มีชิ้นงาน ผิดชิ้น ผิดตำแหน่ง)</td><td><b>CHECK</b></td></tr></table>`)}

<h2 id="wi-time">11. เวลาประมวลผล</h2>
${fig(L, "28_timing", "แท็บ 2 · ⏱ เวลาประมวลผล", ["เวลาของภาพล่าสุด (cycle = กดถ่าย → ได้ผล) · แต่ละภาพแสดงที่แถว เวลา ในข้อมูลภาพ (ชี้เมาส์เพื่อดูทุกขั้นตอน)", "สถิติแต่ละขั้นตอน: จำนวน ค่าเฉลี่ย 95 % สูงสุด (มิลลิวินาที)", "เวลาไซเคิลสูงสุด: ถ้าเกินจะแจ้งเตือน และบอกขั้นตอนที่ช้าที่สุด", "บันทึกทุกภาพลงไฟล์ CSV ของ Camera Bridge (data/logs/timing-วันที่.csv)", "⬇ CSV: ดาวน์โหลดตารางเวลา"])}
<table class="tbl wi-tbl"><tr><th>ขั้นตอน</th><th>ความหมาย</th><th>ถ้าช้า</th></tr>
<tr><td>grab / wait / convert</td><td>กดถ่าย → ได้ภาพ (exposure + ส่งภาพ USB) / แปลงสี</td><td>ลด exposure, ใช้ USB 3.0, Mono8 ถ้าไม่ต้องใช้สี</td></tr>
<tr><td>transfer · load</td><td>ส่งภาพเข้าเบราว์เซอร์ · ถอดรหัสภาพ</td><td>ลดขนาดภาพ (ROI) ให้พอดีชิ้นงาน</td></tr>
<tr><td>circles · align</td><td>หารู REF / หาตำแหน่งชิ้นงาน</td><td>โหมด Fixture หรือลดระยะค้นหา</td></tr>
<tr><td>tools · ocr · code</td><td>เครื่องมือวัด · อ่านตัวอักษร · อ่าน 2D code</td><td>กำหนดกรอบ 2D code (ไม่ค้นทั้งภาพ) · ลดจำนวน OCR</td></tr>
<tr><td>queue</td><td>รอภาพก่อนหน้า (วัดทีละภาพ)</td><td>ถ่ายภาพถัดไปหลังได้ผล</td></tr></table>

<h2 id="wi-train">12. สอนตัวอ่านตัวอักษรเอง (Training)</h2>
<p>เมื่อ OCR ในตัว (Tesseract) อ่านตัวอักษรเลเซอร์ผิด เช่น Z เป็น 7 หรือมีรอยขอบชิ้นงานเป็นตัวเกิน ให้สอนตัวอ่านจากภาพตัวอักษรจริงของเราเอง ตัวอ่านที่สอนแล้วอ่านเร็ว (ประมาณ 20–60 ms ต่อกรอบ) และตอบได้เฉพาะตัวอักษรที่สอนไว้ ข้อมูลทั้งหมดเก็บในเครื่องนี้ (เบราว์เซอร์) ไม่ต้องใช้อินเทอร์เน็ต</p>
${step(1, "ผู้ดูแลระบบ: กรอบตัวอักษรในโปรแกรมการวัด", `<p>วาดกรอบ 🔤 Text (OCR) <b>หนึ่งกรอบต่อหนึ่งบรรทัด</b> ให้มีขอบว่างรอบตัวอักษรเล็กน้อย ไม่รวม 2D code และขอบชิ้นงาน ตั้ง Format (เช่น AAA9) ให้ถูกต้อง</p>`)}
${step(2, "เก็บภาพตัวอักษรตอนวัด", `${fig(L, "29_train_save", "แท็บ 2 · วัดภาพถ่าย", ["ผลอ่านตัวอักษรของภาพนี้", "<b>💾 Save characters</b>: ตัดตัวอักษรในกรอบ OCR ของภาพนี้เก็บเป็นภาพสอน (32×32)", "ไปที่แท็บ 🧠 Training เพื่อตรวจป้ายชื่อ"])}<p>หรือติ๊ก <b>Save characters of every measured photo</b> ในแท็บ Training เพื่อเก็บทุกภาพที่วัดอัตโนมัติ ป้ายชื่อ (label) มาจากผลอ่าน OCR เฉพาะเมื่อจำนวนตัวตรงกัน format ผ่าน และความมั่นใจ ≥ 60 % ไม่เช่นนั้นจะเป็น <b>?</b></p>`)}
${step(3, "ตรวจและแก้ป้ายชื่อ", `${fig(L, "30_train_images", "แท็บ 🧠 Training · ภาพตัวอักษร", ["กรองตามโปรแกรม · กรอบ", "กรองสถานะ: ? ไม่มีป้าย / จากผลอ่าน (ยังไม่ตรวจ) / ตรวจแล้ว / ตัวอ่านไม่เห็นด้วย", "จำนวนต่อตัวอักษร: ตรวจแล้ว/ทั้งหมด (สีส้ม = น้อยเกินไป)", "คลิกเลือกภาพ แล้ว<b>พิมพ์ตัวอักษร</b>บนคีย์บอร์ด = ตั้งป้ายและข้ามไปภาพถัดไป · Enter = ป้ายถูกแล้ว · Delete = ลบ", "ตั้งป้ายให้หลายภาพพร้อมกัน", "✔ Checked: ยืนยันว่าป้ายของภาพที่เลือกถูก", "เก็บภาพตัวอักษรทุกครั้งที่วัด", "นำเข้าภาพจากไฟล์ / โฟลเดอร์ (A/001.png) / ไฟล์ข้อมูล"])}<p>จุดมุมขวาบน: <span class="bad">แดง</span> = ไม่มีป้าย · <span class="warn">ส้ม</span> = ป้ายจากผลอ่าน ยังไม่ตรวจ · <span class="ok">เขียว</span> = ตรวจแล้ว <b>ป้ายผิดสอนคำตอบผิด</b> ตรวจทุกภาพก่อนสอน ลบภาพที่ตัดไม่ครบหรือเป็นรอยสกปรก เป้าหมาย 50+ ภาพต่อตัวอักษร จากหลายวัน หลายชิ้นงาน</p>`)}
${step(4, "สอน (Train)", `${fig(L, "31_train_model", "แท็บ 🧠 Training · สอนตัวอ่าน", ["ใช้เฉพาะภาพที่ตรวจป้ายแล้ว (แนะนำ)", "ตัวอักษรและจำนวนภาพที่จะใช้ · ตัวที่มีภาพน้อยกว่าขั้นต่ำจะถูกตัดออก", "▶ Train: 70 % ใช้สอน · 15 % ตรวจระหว่างสอน (validation) · 15 % สอบครั้งสุดท้าย (test)", "กราฟความแม่นต่อรอบ (epoch): เส้นประ = ภาพที่ใช้สอน · เส้นทึบ = validation", "ผล: ความแม่นของ test · ช่วงความผิดพลาดที่อาจเป็นจริง · ตัวที่สับสน · ภาพที่อ่านผิด (คลิกเพื่อตรวจป้าย)"])}<p>ถ้า training สูงกว่า validation มาก = จำภาพแทนที่จะเรียนรู้รูปร่าง (overfitting) ให้เพิ่มภาพที่หลากหลาย หลังสอนครั้งแรก ใช้ตัวกรอง <b>Reader disagrees with label</b> เพื่อหาป้ายที่น่าจะผิด และ <b>🤖 Pre-label</b> เพื่อเติมป้ายให้ภาพ ? (ยังต้องตรวจ)</p>`)}
${step(5, "นำไปใช้ในโปรแกรม", `${fig(L, "32_train_use", "แท็บ 🧠 Training · ตัวอ่านที่สอนแล้ว", ["รายการตัวอ่าน (คลิกเพื่อเลือก)", "เลือกกรอบ OCR ของโปรแกรมที่เปิดอยู่", "Use in program: กรอบนี้อ่านด้วยตัวอ่านที่สอน (Built-in OCR = กลับไปใช้ Tesseract)", "Test on new images: ทดสอบกับภาพใหม่ที่ตัวอ่านไม่เคยเห็น", "⬇ Export reader: ย้ายไปเครื่องอื่น (นำเข้าด้วย ⬆ Data / reader…)"])}${fig(L, "33_train_reader", "แท็บ 1 · คุณสมบัติกรอบ OCR", ["Reader: Built-in OCR หรือตัวอ่านที่สอน", "กรอบสีเขียว = ตัวอักษรที่หาเจอ · สีแดง = ไม่มั่นใจ", "💾 Save characters ของภาพต้นแบบ"])}<p><b>บันทึกโปรแกรมลงคลัง (Library)</b> เพื่อให้ผู้ปฏิบัติงานใช้ ตัวอ่านเก็บแยกในเครื่อง: เครื่องอื่นต้องนำเข้าไฟล์ตัวอ่านด้วย สำรองข้อมูลภาพด้วย ⬇ Export data</p>`)}
<table class="tbl wi-tbl"><tr><th>ปัญหา</th><th>สาเหตุ / วิธีแก้</th></tr>
<tr><td>ตัวอักษรหายหรือเกิน</td><td>กรอบชิดตัวอักษรเกินไปหรือรวมขอบชิ้นงาน/2D code · วาดกรอบใหม่ หนึ่งบรรทัดต่อกรอบ</td></tr>
<tr><td>ตอบตัวที่ไม่ได้สอน ไม่ได้</td><td>ตัวอ่านรู้เฉพาะตัวที่สอน (ดู "knows" ในคุณสมบัติกรอบ) · เก็บภาพตัวนั้นเพิ่มแล้วสอนใหม่</td></tr>
<tr><td>test สูงแต่ใช้งานจริงผิด</td><td>ภาพสอนไม่หลากหลาย (วันเดียว ชิ้นเดียว) · เก็บจากหลายล็อต/กะ แล้วใช้ Test on new images</td></tr></table>
`;
  }

  // ------------------------------------------------------------------ ENGLISH
  function en() {
    const L = "en";
    return `
<div class="wi-head">
  <div><h1>Work Instruction — Photo Measurement</h1>
  <div class="muted">Version 0.6.0 · open index.html in Chrome or Edge (no installation) · with an industrial camera: open through the Camera Bridge (section 9)</div></div>
  <button class="btn primary no-print" onclick="window.print()">🖨 Print / Save as PDF</button>
</div>

<div class="card wi-toc no-print"><b>Contents</b>
  <ol>
    <li><a href="#wi-flow">Workflow overview</a></li>
    <li><a href="#wi-login">Log in</a></li>
    <li><a href="#wi-prog">Admin: create a part program</a></li>
    <li><a href="#wi-meas">Operator: measure photos</a></li>
    <li><a href="#wi-err">When a result shows ERR</a></li>
    <li><a href="#wi-rep">Reports</a></li>
    <li><a href="#wi-photo">How to take the photo</a></li>
    <li><a href="#wi-trouble">Troubleshooting</a></li>
    <li><a href="#wi-cam">Industrial camera (Camera Bridge)</a></li>
    <li><a href="#wi-cal">Station calibration (no REF holes)</a></li>
    <li><a href="#wi-time">Processing time</a></li>
    <li><a href="#wi-train">Train your own character reader (Training)</a></li>
  </ol>
</div>

<h2 id="wi-flow">1. Workflow overview</h2>
<div class="wi-flow">
  <div class="wi-box admin">Admin<br><small>creates the part program on a master photo and saves it to the library</small></div><span>➜</span>
  <div class="wi-box">Operator<br><small>selects the program → adds photos</small></div><span>➜</span>
  <div class="wi-box">Check OK / NG<br><small>fix results that show ERR</small></div><span>➜</span>
  <div class="wi-box">Report<br><small>Excel · PDF · Word · CSV</small></div>
</div>
<p>Principle: the part has <b>reference holes (REF1, REF2)</b> of known size. In every photo they give the scale (mm per pixel), the position and the angle of the part, so no fixture is needed and every point of the program is measured automatically.</p>

<h2 id="wi-login">2. Log in</h2>
${step(1, "First start: create the admin account", `<p>Double-click <b>index.html</b>. The first time, create the administrator. Later, choose your user name and enter your password.</p>
${fig(L, "01_login", "Login screen", ["Admin name (later: list of users)", "Password (at least 4 characters)", "Repeat password (first start only)", "Create the account and log in"])}
<p class="note">Operators only see <b>Measure photos</b>, <b>Report</b> and <b>Help</b>; they cannot change programs.</p>`)}

<h2 id="wi-prog">3. Admin: create a part program</h2>
${step(1, "Load the master photo and choose the reference holes", `<p>Use a sharp photo taken straight from above. Yellow circles are the holes the program found.</p>
${fig(L, "02_master", "Tab 1 · Part program", ["<b>Load master photo</b>", "Tool <b>◎ REF1</b>", "Click inside reference hole 1 (origin)", "Tool <b>◎ REF2</b>", "Click inside reference hole 2 (X direction)"])}`)}
${step(2, "Reference settings", `${fig(L, "03_refs", "Part & reference circles", ["<b>Reference</b>: 2 circles (most accurate) or 1 circle", "<b>Rotation from</b>: REF1→REF2, a measured edge/point, image match with the master, or none (jig)", "Real REF1 diameter from the drawing (mm)", "Real REF2 diameter from the drawing (mm)", "Scale (px/mm) and check value; keep the check below 3 %"])}
<p class="note">Aim for at least <b>20 px/mm</b>. If lower, take the photo closer or use the 2× lens.</p>`)}
${step(3, "Place the measuring tools", `${fig(L, "04_tools", "Toolbar", ["<b>Circle</b>: drag from the centre to the edge → diameter, roundness", "<b>Arc</b>: click 3 points on the arc", "<b>Line</b>: drag along the edge; the arrow is the scan direction", "<b>Edge point</b>: drag across the edge", "<b>Colour point</b>: drag from the centre of a colour spot; the master colour is taught", "<b>2D code area</b>: drag from the DataMatrix centre to a corner → serial number", "<b>Text (OCR)</b>: drag a box around one line of text", "<b>Report area</b>: drag around the part → picture in reports, also used to match new photos"])}
<p>Constructed elements (card <b>Construct</b>): midpoint, intersection, perpendicular foot, line through 2 points, circle through 3 points, parallel, perpendicular, bisector.</p>`)}
${step(4, "Adjust the search area and edge settings", `<p>Select a tool (on the photo or in the <b>Elements</b> table) and drag its handles.</p>
${fig(L, "05_props", "Tool properties", ["Handle ● moves the search area", "Handle ■ changes the size (radius / band width)", "<b>Edge polarity</b>: dark→bright, bright→dark or any", "<b>Threshold</b>: minimum brightness step that counts as an edge (lower = easier to find)", "<b>Redraw area</b>"])}
<p class="note">Green = measured, yellow dots = detected edge points, dashed = search area.</p>`)}
${step(5, "Read text (OCR)", `${fig(L, "06_ocr", "Text (OCR)", ["Text box on the photo", "<b>Format</b>: A letter, 9 digit, X either, ? any — e.g. AAA9 for DZZ0; fixes look-alikes (0/O, 2/Z, 5/S, 8/B)", "Image the OCR used, reading and confidence %", "<b>Read again</b> after changing settings"])}
<p>For vertical text choose <b>Text direction</b> 90°/180°/270° · text should be at least about 20 px high in the photo · Latin letters and digits only.</p>`)}
${step(6, "Dimensions and specifications", `${fig(L, "07_dims", "Dimensions & tolerances", ["Type: distance, X/Y, diameter, radius, angle, area, roundness, straightness, parallelism, perpendicularity, position, concentricity, colour ΔE, text", "Element A (and B)", "<b>+ Add</b> — the nominal is taken from the master", "<b>Specification</b> of a number (example: range min … max)", "Text specification, e.g. = {DM:0-4}: must equal the first 4 characters of the 2D code"])}
<table class="tbl wi-tbl"><tr><th>Specification</th><th>Example</th><th>OK when</th></tr>
<tr><td>nominal ± tolerance</td><td>2.900 +0.05/−0.05</td><td>inside the tolerance</td></tr>
<tr><td>range min … max</td><td>2.85 … 2.95</td><td>min ≤ value ≤ max</td></tr>
<tr><td>&gt; · &lt; · ≥ · ≤</td><td>≥ 6.95</td><td>the comparison holds</td></tr>
<tr><td>= · ≠ (± eps)</td><td>= 4 ±0.01</td><td>equal / not equal within eps</td></tr>
<tr><td>text: = · ≠ · contains · starts · ends · regex · fits format</td><td>= {DM:0-4}</td><td>the text rule holds</td></tr>
<tr><td>colour ΔE</td><td>0 … 5</td><td>below 2 hard to see, above 10 clearly different</td></tr></table>`)}
${step(7, "Image processing (when needed)", `${fig(L, "08_proc", "Image processing", ["Colour channel: choose the one where the part differs most from the background", "Brightness, contrast, gamma", "<b>Match brightness to master</b> before finding edges", "Circle detection settings (when a reference hole is not found)", "<b>Processed image</b>: shows what the detector sees"])}`)}
${step(8, "Save to the program library", `${fig(L, "09_library", "Program library", ["<b>Save to library</b> — operators can then select it; each save is a new version", "Programs in the library (open / delete)", "Version, date and who saved it", "<b>Export file</b> (.pm.json) for backup or another PC"])}`)}
${step(9, "Users", `${fig(L, "10_users", "Users tab", ["User name", "Role: Operator (measure/report) or Admin (programs/users)", "Password", "<b>Add user</b>", "User list: change role, new password, delete"])}
<p class="note">Users and the library are stored in this browser on this PC.</p>`)}

<h2 id="wi-meas">4. Operator: measure photos</h2>
${step(1, "Select the program and add photos", `${fig(L, "11_measure", "Tab 2 · Measure photos", ["<b>Program</b>: select the part program from the library", "<b>Add photos…</b> — many at once (or drag and drop)", "Photo list with OK / NG / CHECK; the name is the serial from the 2D code", "<b>Aligned</b>: every photo turned/scaled like the master · <b>Original</b>: as taken", "Photo info: serial, 2D code, OCR texts, date/time, scale", "Results of each dimension against its specification"])}
<p>◀ ▶ or the arrow keys go to the next photo · <b>Same view for all</b> keeps the same spot on every part.</p>`)}
${step(2, "Check results and compare with the master", `${fig(L, "12_compare", "Compared with master", ["Brightness, contrast, colour, size (camera distance), sharpness and angle vs the master (orange = large difference)", "<b>Master overlay</b>: blend the master over the photo to check the alignment", "<b>Image adjust (this photo)</b> or <b>Match master</b>", "Example: the colour point is NG because of a stain"])}
<p>Status: <span class="pill OK">OK</span> all pass · <span class="pill NG">NG</span> a dimension fails · <span class="pill CHECK">CHECK</span> an element was not found or the alignment is doubtful (tilt, wrong part, wrong hole).</p>`)}

<h2 id="wi-err">5. When a result shows ERR</h2>
${step(1, "Press 🔧 Fix next to the ERR value", `${fig(L, "13_err", "A dimension that could not be measured", ["<b>🔧 Fix</b> button", "Status of the photo"])}`)}
${step(2, "Adjust the search area or use Auto search", `${fig(L, "14_fix", "Adjust search areas (this photo only)", ["The view zooms to the tool that failed; drag the ● handle so the search area lies on the edge", "Edge settings for this photo", "<b>Auto search</b>: tries wider areas and lower thresholds, keeps the result closest to the master", "<b>Reset this photo</b>"])}
${fig(L, "15_fixed", "After the fix", ["Status is OK", "Note that settings were changed for this photo and by whom (also in the report)"])}
<p class="note">Wrong reference hole: use <b>Swap REF1/REF2</b> or <b>Pick REF1, REF2 by hand</b>. An admin can press <b>Copy to program</b> to use the fix for all photos.</p>`)}

<h2 id="wi-rep">6. Reports</h2>
${step(1, "Choose the report", `${fig(L, "16_report", "Tab 3 · Report", ["Inspector / company", "Language: English, Thai or both", "Photos: all, NG/CHECK only, OK only, selected photo", "Values: all, NG only, OK only, summary only", "Export Excel, PDF, Word or CSV"])}
${fig(L, "17_report_page", "Example PDF page: photo info, picture with the measurements drawn, results table", [])}`)}

<h2 id="wi-photo">7. How to take the photo</h2>
${fig(L, "18_photo_tips", "Photo examples", [])}
<table class="tbl wi-tbl"><tr><th>Do</th><th>Why</th></tr>
<tr><td>Hold the phone parallel to the part, straight from above</td><td>tilt turns circles into ellipses and breaks the scale</td></tr>
<tr><td>Fill the photo with the part, ≥ 20 px/mm; use the 2× lens rather than moving closer</td><td>more resolution, less perspective</td></tr>
<tr><td>Plain contrasting background, soft even light, no glare</td><td>clear edges, true colours</td></tr>
<tr><td>Both reference holes fully visible and sharp</td><td>they set the scale of every photo</td></tr>
<tr><td>Similar distance and light as the master</td><td>see <b>Compared with master</b>; orange values → take the photo again</td></tr></table>

<h2 id="wi-trouble">8. Troubleshooting</h2>
<table class="tbl wi-tbl"><tr><th>Symptom</th><th>Possible cause</th><th>Action</th></tr>
<tr><td>CHECK: “low match with master image”</td><td>wrong part / program, or wrong reference hole</td><td>check the program · Pick REF by hand</td></tr>
<tr><td>CHECK: “reference diameters disagree”</td><td>tilted photo, holes not in one plane</td><td>retake straight from above</td></tr>
<tr><td>ERR on a dimension</td><td>weak or dark edge, search area off the edge</td><td>🔧 Fix → Auto search or drag the area · Match master</td></tr>
<tr><td>Serial / text not read</td><td>too small, blurred, glare</td><td>take the photo closer · type the serial</td></tr>
<tr><td>Colour NG on every photo</td><td>light differs from the master</td><td>add a white/gray reference point · same lighting</td></tr>
<tr><td>low resolution (&lt; 20 px/mm)</td><td>too far away</td><td>closer or 2× lens</td></tr></table>
<p class="muted small">Values are indicative, measured from phone photos; not a calibrated measuring instrument. Validate against a CMM/OMM before using them for acceptance.</p>
<h2 id="wi-cam">9. Industrial camera (Camera Bridge)</h2>
<p>A Basler camera (USB 3.0) replaces the phone photos. Part programs, specifications and reports work exactly as before.</p>
${step(1, "Install once, then start", `<ol>
<li>Install the <b>Basler pylon Software Suite (x64)</b>, profile <b>Developer</b> (includes the .NET API), and the Microsoft <b>ASP.NET Core Runtime 8 or newer (x64)</b>.</li>
<li>Plug the camera into a <b>USB 3.0</b> port of the PC (no hub), or a GigE camera into its network port, and <b>close pylon Viewer / MVS</b> (only one program can use the camera).</li>
<li>Double-click <b>Start PhotoMeasure Camera.cmd</b> → the browser opens <b>http://127.0.0.1:5090</b> (keep the black Camera Bridge window open).</li>
<li>First time: users and programs of index.html are kept separately. Use <b>⬇ Backup</b> in the Users tab of index.html, then <b>⬆ Restore a backup</b> on this login page.</li></ol>`)}
${step(2, "Admin: connect the camera", `${fig(L, "19_cam_conn", "Tab 📷 Camera · connection", ["<b>📷 Camera</b> tab (shown when the Camera Bridge runs)", "Camera state in the header (green = connected)", "Choose the camera (↻ search again)", "<b>Connect</b> · next time it connects automatically and reconnects after unplugging", "Camera info: model, serial, temperature, USB speed (must be SuperSpeed)", "Camera name, e.g. Station 1"])}`)}
${step(3, "Live view and positioning", `${fig(L, "20_cam_live", "Live view", ["<b>▶ Live</b> on / off", "<b>Freeze</b> / resume live", "<b>📷 Grab</b> (or Space / foot switch): a full-resolution image, measured at once", "<b>Measure</b>: measure every grab with the selected program", "<b>Master overlay</b> and the master's REF circles: place the part like on the master", "Status: fps, image size, exposure, mean brightness, % over-exposed, focus value"])}`)}
${step(4, "Admin: camera setup", `${fig(L, "21_cam_setup", "Camera setup", ["Histogram: no red bars (over-exposed); red pixels in the live view are over-exposed", "Focus value: turn the lens to the highest value", "<b>Exposure time</b>: bright enough but not over-exposed (keep gain low to limit noise)", "<b>Auto once</b>: the camera adjusts once, then keeps the value (white balance: put a white card first)", "<b>Save to program</b>: the camera settings are stored in the part program and applied whenever it is selected; then <b>Save to library</b>", "User set: store settings in the camera / start-up set", "⬇/⬆ .pfs: back up or load camera settings as a file (also for pylon Viewer)"])}`)}
${step(5, "Admin: master image from the camera", `${fig(L, "24_cam_master", "Tab 1 · Part program", ["<b>📷 Grab master</b>: use a camera image as the master; the camera settings are stored with it. Then set REF1/REF2 and the tools as in section 3."])}`)}
${step(6, "Operator: grab and measure", `<p>Select the program in tab 2, place the part and press <b>📷 Grab</b> (Camera or Measure tab) or <b>Space</b>.</p>
${fig(L, "22_cam_result", "Result after a grab", ["Overall OK / NG with serial and time; failed dimensions are listed below", "Last result: every value", "<b>Open in Measure</b>: details, ERR fixes as for photos"])}
${fig(L, "25_cam_measure", "Tab 2 · Measure", ["<b>📷 Grab</b>: camera images join the list like photos and go into the normal reports"])}`)}
${step(7, "Record images", `${fig(L, "23_cam_record", "Record images", ["<b>💾 Save image</b>: saves the image on the screen (or a new grab)", "Number of images and interval for a sequence (repeatability tests)", "<b>● Record sequence</b> / ■ Stop", "Auto-save after measuring: every image or NG only (image and/or result picture)", "File name {program} {serial} {status} {date} {time} {n} … and folder (one sub-folder per day)", "Recorded images: open, or <b>Measure</b> again"])}`)}
<table class="tbl wi-tbl"><tr><th>Symptom</th><th>Possible cause</th><th>Action</th></tr>
<tr><td>No 📷 Camera tab</td><td>Camera Bridge not running</td><td>double-click Start PhotoMeasure Camera.cmd</td></tr>
<tr><td>No camera found</td><td>pylon Viewer / MVS open · cable · power</td><td>close pylon Viewer / MVS · re-plug into USB 3.0 · GigE camera: put its IP in the subnet of the network card (in MVS) · press ↻</td></tr>
<tr><td>pylon: Basler.Pylon.dll not found</td><td>pylon installed without the .NET API</td><td>install pylon with the Developer profile · open Diagnostics and send it to the admin</td></tr>
<tr><td>No image from the camera (timeout)</td><td>Trigger mode = On · very long exposure</td><td>set Trigger mode = Off · shorter exposure</td></tr>
<tr><td>USB High speed (USB 2)</td><td>USB 2.0 port or hub</td><td>use a blue USB 3.0 port on the PC</td></tr></table>
<h2 id="wi-cal">10. Station calibration (no REF holes)</h2>
<p>For a fixed camera (camera distance, lens, focus never change) and parts without reference holes. The scale (mm per pixel) is measured once with a <b>calibration plate</b> and used for every image.</p>
<div class="card"><b>Prepare</b><ul>
<li>A certified <b>dot-grid plate</b> (known dot pitch, e.g. 0.5 or 1.000 mm) that fills the field of view, or a ring / pin gauge of known Ø (less accurate).</li>
<li>The plate surface must be at the <b>same height as the measured surface of the part</b> (another height = another scale) · camera square to the part · a telecentric lens is best.</li>
<li>Do not change focus, zoom, camera distance, binning or image size after calibrating (if you do: calibrate again).</li></ul></div>
${step(1, "Admin: calibrate with the plate (📷 Camera tab)", `${fig(L, "26_cal_plate", "Station calibration", ["Calibration state of this camera (valid / expires soon / expired)", "Plate: dot grid or ring / pin gauge", "Dot pitch (mm) from the plate certificate", "Valid for (days), e.g. 30", "<b>📷 Grab plate</b> or <b>Load plate image</b>", "Result picture: green dots = good, orange/red = off position (lines = error direction, magnified)", "Result: scale µm/px, X/Y, squareness, dot error RMS/max, lens distortion", "<b>Save calibration</b> · <b>Check against saved</b> (daily check, limit ±0.05 %)"])}
<p class="small">Guide values: dot error RMS &lt; 1/10 of the tightest tolerance · X/Y difference &lt; 0.2 % · distortion &lt; 0.1 % (if more, keep the measured features near the image centre).</p>`)}
${step(2, "Admin: let a program use the station calibration", `${fig(L, "27_cal_program", "Tab 1 · Part program", ["Reference = <b>Fixed calibration (station, no REF holes)</b>", "Station (camera) to use", "Part position: <b>Fixture</b> (always the same place, fastest) · <b>Search position</b> · <b>Search position + rotation</b>", "Search range (mm), empty = whole image (smaller = faster)", "Scale from the calibration and warnings"])}
<ol><li>Load / grab the master <b>after</b> calibrating (same camera and settings). The program origin is the image centre (◎ REF1 moves it).</li>
<li>Draw the <b>Report area</b> around the part: it is used to find the part in new images.</li>
<li>Set the <b>Datum</b> (origin / axis) on holes or edges of the part, so X/Y values belong to the part, not to the image.</li>
<li>With at least one circle (and a line) the position and angle are refined on these features, and the part size is checked against the master.</li></ol>`)}
${step(3, "Protection against wrong results", `<table class="tbl wi-tbl"><tr><th>Situation</th><th>Result</th></tr>
<tr><td>No calibration · image size (ROI / binning) differs from the calibration · image from another camera</td><td><b>FAIL</b>, not measured</td></tr>
<tr><td>Calibration expired</td><td><b>CHECK</b> with a warning to calibrate again</td></tr>
<tr><td>Part looks larger / smaller than the master (part height, camera distance or focus changed)</td><td><b>CHECK</b></td></tr>
<tr><td>Image does not match the master (no part, wrong part, wrong place)</td><td><b>CHECK</b></td></tr></table>`)}

<h2 id="wi-time">11. Processing time</h2>
${fig(L, "28_timing", "Tab 2 · ⏱ Processing time", ["Time of the last image (cycle = grab → result) · each photo shows it in the Time row of its info (hover for every step)", "Statistics per step: count, average, 95 %, maximum (ms)", "Cycle-time limit: a warning names the slowest step when it is exceeded", "Log every image to the Camera Bridge CSV (data/logs/timing-date.csv)", "⬇ CSV: download the timing table"])}
<table class="tbl wi-tbl"><tr><th>Step</th><th>Meaning</th><th>If slow</th></tr>
<tr><td>grab / wait / convert</td><td>button → image (exposure + USB transfer) / colour conversion</td><td>shorter exposure, USB 3.0, Mono8 if colour is not needed</td></tr>
<tr><td>transfer · load</td><td>image into the browser · decoding</td><td>smaller image (ROI) around the part</td></tr>
<tr><td>circles · align</td><td>find REF holes / find the part</td><td>Fixture mode or a smaller search range</td></tr>
<tr><td>tools · ocr · code</td><td>measuring tools · text reading · 2D code</td><td>draw a 2D code area (no whole-image search) · fewer OCR boxes</td></tr>
<tr><td>queue</td><td>waiting for the previous image (one at a time)</td><td>grab the next part after the result</td></tr></table>

<h2 id="wi-train">12. Train your own character reader (Training)</h2>
<p>When the built-in OCR (Tesseract) misreads your laser marks – Z read as 7, a part edge read as an extra character – train a reader on images of your own characters. A trained reader is fast (about 20–60 ms per text box) and answers only with characters it was trained on. Everything stays on this PC (browser storage); no internet.</p>
${step(1, "Admin: text areas in the part program", `<p>Draw one 🔤 Text (OCR) box <b>per text line</b>, with a small margin around the characters, without the 2D code or part edges. Set the format (e.g. AAA9) correctly.</p>`)}
${step(2, "Collect character images while measuring", `${fig(L, "29_train_save", "Tab 2 · Measure photos", ["Text read on this photo", "<b>💾 Save characters</b>: cut the characters of the OCR boxes of this photo out as training images (32×32)", "Open 🧠 Training to check the labels"])}<p>Or tick <b>Save characters of every measured photo</b> in the Training tab. The label comes from the OCR reading only when the number of characters matches, the format is met and the confidence is 60 % or more; otherwise it is <b>?</b>.</p>`)}
${step(3, "Check and correct the labels", `${fig(L, "30_train_images", "Tab 🧠 Training · character images", ["Filter by program · text element", "Filter by state: ? no label / label from reading (not checked) / checked / reader disagrees", "Images per character: checked/all (orange = too few)", "Click an image, then <b>type the character</b> on the keyboard = label it and move on · Enter = label is correct · Delete = delete", "Set the label of many selected images", "✔ Checked: the labels of the selected images are correct", "Save characters on every measurement", "Import image files / a folder (A/001.png) / a data file"])}<p>Dot in the corner: <span class="bad">red</span> = no label · <span class="warn">orange</span> = label from the reading, not checked · <span class="ok">green</span> = checked. <b>A wrong label teaches a wrong answer</b>: check every image before training, delete cut-off or dirty crops. Aim for 50+ images per character from several days and parts.</p>`)}
${step(4, "Train", `${fig(L, "31_train_model", "Tab 🧠 Training · train a reader", ["Only images with checked labels (recommended)", "Characters and number of images used · characters with fewer than the minimum are left out", "▶ Train: 70 % teach · 15 % check progress (validation) · 15 % final test", "Accuracy per epoch: dashed = training images · solid = validation", "Result: test accuracy · how high the real error rate may still be · confused pairs · test mistakes (click to check the label)"])}<p>Training much higher than validation = the reader remembers its images instead of learning the shapes (overfitting): add more varied images. After a first training, the filter <b>Reader disagrees with label</b> finds labels that are probably wrong, and <b>🤖 Pre-label</b> fills the labels of ? images (still to be checked).</p>`)}
${step(5, "Use it in the program", `${fig(L, "32_train_use", "Tab 🧠 Training · trained readers", ["Readers on this PC (click to choose)", "Text element of the open program", "Use in program: this element reads with the trained reader (Built-in OCR = back to Tesseract)", "Test on new images: accuracy on images this reader has never seen", "⬇ Export reader: move it to another PC (import with ⬆ Data / reader…)"])}${fig(L, "33_train_reader", "Tab 1 · OCR element properties", ["Reader: built-in OCR or a trained reader", "Green boxes = characters found · red = unsure", "💾 Save characters of the master"])}<p><b>Save the program to the library</b> so operators use it. Readers are stored on this PC: another PC needs the exported reader file. Back up the images with ⬇ Export data.</p>`)}
<table class="tbl wi-tbl"><tr><th>Problem</th><th>Cause / fix</th></tr>
<tr><td>Characters missing or extra</td><td>Box too tight, or it contains a part edge / 2D code · redraw it, one line per box</td></tr>
<tr><td>A character can never be read</td><td>The reader knows only trained characters (see "knows" in the element properties) · collect images of it and train again</td></tr>
<tr><td>High test result, wrong in production</td><td>Training images not varied (one day, one part) · collect from several lots / shifts and use Test on new images</td></tr></table>
`;
  }

  function render(lang) {
    const box = document.querySelector("#tab-help .pad");
    if (!box) return;
    box.classList.add("wi");
    box.innerHTML = lang === "th" ? th() : en();
  }
  return { render };
})();
