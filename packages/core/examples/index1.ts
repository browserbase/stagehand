import "dotenv/config";
// import { Stagehand } from "@browserbasehq/stagehand";
import { Stagehand } from "../lib/v3";
import { chromium } from "playwright-core";
import { z } from "zod/v3";

async function main() {
  /**
   * 1. 处理第一页把产品名称扒下来，写到一个列表里面，创建一个公司集合
   * 2. 重新走查询的逻辑，点击第n个产品，抽取公司列表
   *   2.1 判断公司是否在集合里，如果不在的话走点击抽取的流程，把抽取结果加到公司详情集合里
   * 3. 把公司集合打印出来
   */
  const stagehand = new Stagehand({
    env: "LOCAL",
    model: "deepseek/deepseek-chat",
  });

  await stagehand.init();

  console.log(`Stagehand Session Started`);
  console.log(
    `Watch live: https://browserbase.com/sessions/${stagehand.browserbaseSessionId}`,
  );

  const browser = await chromium.connectOverCDP({
    wsEndpoint: stagehand.connectURL(),
  });

  const pwContext = browser.contexts()[0];
  const pwPage = pwContext.pages()[0];

  await pwPage.goto("https://www.aqbz.com/#/zscx");
  await pwPage.getByRole("textbox", { name: "输入产品名称" }).fill("摄像");
  await pwPage.getByRole("button", { name: "查询" }).click();
  //   await pwPage.getByText('本安型云台摄像仪').click();
  //   console.log(`url: ${pwPage.url()}`)
  //   await new Promise(f => setTimeout(f, 5000));
  //   await stagehand.act('点击下一页', { page: pwPage });
  await pwPage.getByText("3", { exact: true }).click();
  await new Promise((f) => setTimeout(f, 5000));
  const products = await stagehand.extract(
    "抽取查询结果中的产品名称",
    z.array(z.string()),
    { page: pwPage },
  );
  console.log(`Products:\n`, products);
  const companySet = new Set<string>();
  const exits =
    "徐州合恒通信有限公司,山东新云鹏电气有限公司,翔和高科智控（江苏）有限公司,徐州科瑞矿业科技有限公司,江苏国传电气有限公司,常州奥普恩自动化科技有限公司,徐州中矿润泰矿业科技有限公司,安徽慎安智能科技有限公司,西安梅隆控制工程有限责任公司,国能乌海能源信息技术有限公司,平安开诚智能安全装备有限责任公司,徐州兆恒工控科技有限公司,中煤科工集团沈阳研究院有限公司,山东东达机电有限责任公司,陕西重构智信科技有限公司,西安澳文智联信息科技有限公司,济南蓝动激光技术有限公司,江苏博一矿业科技有限公司,国锦科技(内蒙古)有限责任公司,西安利雅得电气股份有限公司,徐州铭创自动化科技有限公司,山东海纳物联科技有限公司,常州海图信息科技股份有限公司,江苏恒辰自动化科技有限公司,江苏中谷矿山科技有限公司,常州本安科技有限公司,徐州瑞控机电科技有限公司,徐州易拓通信科技有限公司,中煤电气有限公司,徐州众图智控通信科技有限公司,北京富力通信息技术有限公司,天地（常州）自动化股份有限公司,南京北路智控科技股份有限公司,陕西航泰电气股份有限公司,天津新松智能科技有限公司,华洋通信科技股份有限公司,重庆安策坤科技有限公司,徐州大为自动化设备有限公司,武汉七环电气股份有限公司,徐州珂尔玛科技有限公司,西安重装智慧矿山工程技术有限公司,中煤智能科技有限公司,宇祺智能装备有限公司,常州安尔信智能设备有限公司,内蒙古泰锦睿信息自动化科技有限公司,重庆梅安森科技股份有限公司,江苏三恒科技股份有限公司,重庆菲莫科技有限公司,上海申传电气股份有限公司,北斗天地股份有限公司,翔和高科智控(江苏)有限公司,江苏安锦电气科技有限公司,北京天玛智控科技股份有限公司,浙江宇视科技有限公司,华矿重工有限公司,北京国信华锦科技有限公司,山东中源智安测控设备有限公司,山西中矿伟业智控科技有限公司,山西恒辰和谷科技有限公司,深圳世国科技股份有限公司,徐州惠顿矿业科技开发有限公司,杭州海康威视电子有限公司,郑州恒达智控科技股份有限公司,榆林奇胜电子科技有限公司,山西众合智源数能科技有限公司,常州新泽监控设备有限公司,浙江大华系统工程有限公司,泰安伟诚电子有限公司,山东昕能智能科技集团有限公司,山西沣庆恒能源科技有限公司,煤炭科学技术研究院有限公司,徐州中矿云火信息技术有限公司,罗克西姆自动化（江苏）有限公司,山东诺睿昇机电科技股份有限公司,山西省元智控科技有限公司,廊坊宇视通科技有限公司,山西晋煤集团技术研究院有限责任公司,江苏恒洋自动化科技有限公司,重庆光可巡科技有限公司,山西科达自控股份有限公司,中煤科工开采研究院有限公司,徐州大屯工贸实业有限公司,淄博雍利安自动化设备有限公司,杭州蛟洋通信科技有限公司,徐州宏远通信科技有限公司,徐州江煤科技有限公司,江苏政荣工业科技有限公司,济南华科电气设备有限公司,北京图冠数字地理信息技术有限公司,深圳市神拓机电股份有限公司,江苏北臻电子科技有限公司,天津市恒一机电科技有限公司,陕西西科智安信息科技有限公司,无锡宝通智能物联科技有限公司,徐州圣能科技有限公司,华夏天信智能物联（大连）有限公司,吉林智控电子科技有限公司,上海山源电子科技股份有限公司,徐州致达通信科技有限公司,宁波长壁流体动力科技有限公司,安徽恒泰电气科技股份有限公司,安徽容知日新科技股份有限公司,廊坊速瑞电子技术有限公司,贝赫特（苏州）科技有限公司,太重集团向明智能装备股份有限公司,江苏五洋自控技术股份有限公司,中矿四维发展（山东）自动化技术有限公司,山东大齐通信电子有限公司,中信重工开诚智能装备有限公司,厦门金驹煤化有限公司,常州市佐安电器有限公司,江苏泰诺矿用设备有限公司,武汉天宸伟业物探科技有限公司,淮南润成科技股份有限公司,杭州微影智能科技有限公司,北京速力科技有限公司,大唐盛世(山东)智能设备制造有限公司,河南长业智能科技发展有限公司,山西阳光三极科技股份有限公司,徐州鸿新泽信息科技有限公司,山东宇飞传动技术有限公司,徐州华东机械有限公司,镇江中煤电子有限公司,深圳震有科技股份有限公司,常州赢合通控制科技有限公司,安科高新技术（河南）研究院有限公司,山西晨成科技有限公司,山西华鑫电气有限公司,南京晋一智能科技有限公司,常州恒盾机械科技有限公司,徐州豫和信息科技有限公司,徐州普瑞戴特电气科技有限公司,徐州汉翔科技有限公司,郑州华克智能科技有限公司,徐州锐昌科技有限公司,徐州致拓自动化有限公司,开封市测控技术有限公司,陕西中源智控科技有限公司,众信方智（苏州）智能技术有限公司,江苏科云矿业有限公司,徐州中矿慧鼎通信科技有限公司,荣成宏远电气科技有限公司,河南晟科矿业科技有限公司,山西迈捷科技有限公司,合肥小步智能科技有限公司,临沂市三恒科技发展有限公司,北京中航天佑科技有限公司,山西亿智能科技有限责任公司,西安西林子能源科技有限公司,江苏追光智能科技有限公司,太原海斯特电子有限公司,山东吉泰系统集成有限公司,郑州创新矿山信息技术有限公司,阳泉华越八达矿用电气制造有限公司,国能数智科技开发（北京）有限公司,郑州市恒宇自动化设备有限公司,郑州凯全智能科技有限公司,安徽寰创电气科技有限公司,中滦科技股份有限公司,江苏优特安智能科技有限公司,浙江双视科技股份有限公司,陕西开来机电设备制造有限公司,西安鸿安仪器仪表有限公司,徐州中矿科光机电新技术有限公司,重庆安研科技股份有限公司,山东科创装备制造有限公司,中煤科工集团重庆研究院有限公司,苏州优米康通信技术有限公司,唐山东润自动化工程股份有限公司,上海拜特尔安全设备有限公司,山西莱蔚机电有限公司,山西天地煤机装备有限公司,西安博深安全科技股份有限公司,运城市鑫龙机电有限公司,运城宇安电器制造有限公司,辽宁瑞华实业集团高新科技有限公司,山东三大博安测控技术有限公司,淮南市润金工矿机电有限公司,山东拓新电气有限公司,上海颐坤自动化控制设备有限公司,济南研华科技有限公司,山东禹创电气有限公司,贵州科煤科技有限公司,徐州零距电子科技有限公司,山东兰阀自控设备有限公司,焦作煤业（集团）有限责任公司,徐州睿丰智能科技有限公司,山东鲁科自动化技术有限公司,普联技术有限公司,铁法煤业集团大数据运营有限责任公司,深圳市翌日科技有限公司,徐州北矿智能科技有限公司,云智控(山西)能源科技有限公司,江苏珂尔玛智控技术有限公司,安徽山维自动化设备有限公司,烟台恒邦信息科技有限公司,山西赛安自动控制有限公司,贵州博创智新科技有限公司,南京智惠科技发展有限公司,临沂鑫诚矿用设备有限公司,邯郸市鑫泽机械电子设备有限公司,山西宝能智控装备制造有限公司,山西戴德测控技术股份有限公司,北京柯安盾安全设备有限公司,北京凌天智能装备集团股份有限公司,四川旭信科技有限公司,山东智展控股有限公司,湖南川孚智能科技有限公司,济南恒盾顺利达电子科技有限公司,徐州中矿易通信息科技有限公司,湖南创安防爆电器有限公司,煤炭科学研究总院有限公司,郑州曙光云科技有限公司,湖北景深安全技术有限公司,广东罗尔科技有限公司,济宁邦迈尔机电设备有限公司,天津华宁电子有限公司,陕西智能精鹰电子科技有限公司,北京中电拓方信息技术有限公司,宿州科力电器有限公司,河南奋达科技有限公司,河北伟积电气有限公司,山西华智弘兴科技有限公司,光力科技股份有限公司,江苏龙宇物联网科技有限公司,明创慧远（贵州）技术有限公司,徐州博林高新技术有限责任公司,河南省恒安智控技术有限公司,江苏沃力菲智控科技有限公司,太原市月辉新技术产业有限公司,河南中平自动化股份有限公司,石家庄市义德隆机电设备制造有限责任公司,西安森兰科贸有限责任公司,复恒（重庆）科技有限公司,常州迪泰科特测控设备有限公司,山西海德天地智能科技有限公司,山西普仕达科技有限公司,内蒙古必选机械制造有限公司,泰安恒泰电子仪器有限公司,济南福深兴安科技有限公司,肥城弘锦电气机械科技有限公司,吉林省圣宜达科技有限公司,矿泰智能科技有限公司,太原向明智控科技有限公司,常州联力自动化科技有限公司,山东矿机集团股份有限公司,杭州海康威视数字技术股份有限公司,抚顺格瑞迪电子有限公司,山西和信基业科技股份有限公司,温州市有名机械科技有限公司,山西友利莱智能科技有限公司,山西中科联合工程技术有限公司,安徽德睿智能技术有限公司,中煤科工机器人科技有限公司,北京菲力克技术有限公司,蒂芬巴赫（天津）控制系统有限公司,山西平阳广日机电有限公司,三一重型装备有限公司,浙江上创智能科技有限公司,西安淘美克智能科技有限公司,浙江朝科电器科技有限公司,四川航天电液控制有限公司,山西平阳重工机械有限责任公司,天安联控科技有限公司,山西江源科技有限公司,山东中煤电器有限公司,库柏裕华（常州）电子设备制造有限公司,宁夏广天夏科技股份有限公司,山东科大机电科技股份有限公司,江苏金博途科技有限公司,枣庄和顺达机电科技股份有限公司,中电创融（北京）电子科技有限公司,北京唐柏通讯技术有限公司,陕西朗浩传动技术有限公司,天津贝克电气有限公司,陕西明泰电子科技发展有限公司,徐州金东测控科技有限公司,陕西新奥矿山设备有限公司,北京宏博亚泰电气设备有限公司,山东鲁创能源科技有限公司,太原市鹭海自动化科技有限公司,北京市煤炭矿用机电设备技术开发有限公司,八达电气有限公司,陕西裕硕科技有限公司,山西潞安安易电气有限公司,唐山昌宏科技有限公司,合肥工大高科信息科技股份有限公司,沈阳恩宁机电设备有限公司".split(
      ",",
    );
  exits.map((i) => companySet.add(i));
  const results: string[] = [];
  async function processProduct(product: string) {
    console.log(`处理 Product: `, product);
    // await pwPage.goto('https://www.aqbz.com/#/zscx');
    // await pwPage.getByRole('textbox', { name: '输入产品名称' }).fill('摄像');
    await pwPage.getByRole("button", { name: "查询" }).click();
    // await new Promise(f => setTimeout(f, 5000));
    await pwPage.getByText("3", { exact: true }).click();
    await pwPage.getByText(product, { exact: true }).first().click();
    await new Promise((f) => setTimeout(f, 3000));
    const companys = await stagehand.extract(
      "抽取查询结果中的状态和持证人字段",
      z.array(z.object({ status: z.string(), holder: z.string() })),
      { page: pwPage },
    );
    console.log(`Companys:\n`, companys);
    for (const item of companys) {
      const company = item.holder;
      if (item.status != "有效") {
        console.log("持证人状态异常过滤, ", item.status, " ", item.holder);
        continue;
      }
      if (companySet.has(company)) {
        console.log("公司已经处理过了, ", company);
        continue;
      } else {
        console.log(`处理产品： ${product}, 公司: ${company}`);
      }
      i += 1;
      const page1Promise = pwPage.waitForEvent("popup");
      await pwPage.getByText(company, { exact: true }).first().click();
      try {
        const page1 = await page1Promise;
        let j = 0;
        while (j < 5) {
          await new Promise((f) => setTimeout(f, 1000));
          const result = await stagehand.extract(
            "抽取企业基本信息",
            z.object({
              企业名称: z.string(),
              通讯地址: z.string(),
              邮政编码: z.string(),
              联系人: z.string(),
              联系电话: z.string(),
            }),
            {
              page: page1,
              selector:
                "#app > div.zscx-contaner > div.zscx-detail > div.zscx-detail-q > div.companyInfo",
            },
          );
          console.log(`result ${i}:\n`, result);
          if (result.企业名称 == "") {
            console.log(
              `retry ${j}. error details, product: ${product}, company: ${company}, url: ${page1.url()}`,
            );
            j += 1;
            continue;
          }
          // const resultStr = parseToJson(result.企业名称);
          const resultStr = `${result.企业名称},${result.通讯地址},${result.邮政编码},${result.联系人},${result.联系电话}`;
          results.push(resultStr);
          companySet.add(company);
          break;
        }
        await page1.close();
      } catch (error) {
        console.log(`error: ${error}`);
      }
      // if (i == 1) {
      //     break;
      // }
    }
  }
  let i = 0;
  try {
    for (const product of products) {
      await processProduct(product);
    }
  } catch (error) {
    console.log(`error: ${error}`);
  } finally {
    const companyArr: string[] = [...companySet];
    console.log("公司集合：", companyArr.join(","));
    console.log("详细信息:\n", results.join("\n"));
  }

  //   await pwPage.getByText('本安型云台摄像仪').click();
  //   await new Promise(f => setTimeout(f, 3000));
  //   const companys = await stagehand.extract("抽取查询结果中的持证人", z.array(z.string()), { page: pwPage });
  //   console.log(`Companys:\n`, companys);

  //   for(const item of companys) {
  //     companySet.add(item);
  //   }
  //   for (const item of companySet) {
  //     console.log(item);
  //   }

  //   const page1Promise = pwPage.waitForEvent('popup');
  //   await pwPage.getByText('徐州合恒通信有限公司').first().click();
  //   const page1 = await page1Promise;

  //   await new Promise(f => setTimeout(f, 3000));
  //   const result = await stagehand.extract("抽取企业基本信息", { page: page1 });
  //   console.log(`result:\n`, result);
  //   const resultDict = parseToJson(result.extraction);

  //   const page = stagehand.context.pages()[0];
  //   await page.goto("https://www.aqbz.com/#/zscx");

  // const extractResult = await stagehand.extract(
  //   "Extract the value proposition from the page."
  // );
  // console.log(`Extract result:\n`, extractResult);

  //   const actResult0 = await stagehand.act("在产品名称栏输入'摄像'");
  //   console.log(`Act result:\n`, actResult0);

  //   const actResult = await stagehand.act("点击查询按钮");
  //   console.log(`Act result:\n`, actResult);

  //   await new Promise(f => setTimeout(f, 5000));

  // const extractResult0 = await stagehand.extract(
  //   "抽取查询结果"
  // );
  // console.log(`Extract result:\n`, extractResult0);

  // const actResult2 = await stagehand.act("点击'本安型云台摄像仪'");
  // console.log(`Act result:\n`, actResult2);

  // const extractResult = await stagehand.extract(
  //   "抽取表格内容"
  // );
  // console.log(`Extract result:\n`, extractResult);

  //   const actResult3 = await stagehand.act("点击表格第一条")
  //   console.log("Act result:\n", actResult3);

  // const [observeResult] = await stagehand.observe("点击表格第一条");
  // console.log(`Observe result:\n`, observeResult);

  // const actResult3 = await stagehand.act(observeResult)
  // console.log("Act result:\n", actResult3);

  // await new Promise(f => setTimeout(f, 5000));

  // const extractResult1 = await stagehand.extract(
  //   "抽取表格内容"
  // );
  // console.log(`Extract result:\n`, extractResult1);

  await new Promise((f) => setTimeout(f, 10000));
  // const agent = stagehand.agent({
  //   // cua: true,
  //   model: "deepseek/deepseek-chat",
  //   systemPrompt: "You're a helpful assistant that can control a web browser.",
  // });

  // const agentResult = await agent.execute(
  //   "What is the most accurate model to use in Stagehand?"
  // );
  // console.log(`Agent result:\n`, agentResult);

  await stagehand.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
