"use client";

import Link from "next/link";
import AppHeader from "@/components/chrome/AppHeader";
import Icon, { type IconName } from "@/components/ui/Icon";
import { StudioPage } from "@/components/studio/StudioLayout";
import styles from "./page.module.css";

type JourneyStep = {
  icon: IconName;
  title: string;
  body: string;
};

type FlowStep = {
  index: string;
  title: string;
  simple: string;
  detail: string;
  accent: "blue" | "green" | "amber";
};

const journey: JourneyStep[] = [
  {
    icon: "edit",
    title: "요청 입력",
    body: "생성·수정·영상 모두 오빠가 적은 말에서 시작해.",
  },
  {
    icon: "wand",
    title: "프롬프트 정리",
    body: "AI가 엔진이 읽기 쉬운 영어 문장으로 다듬어.",
  },
  {
    icon: "scan-eye",
    title: "이미지 이해",
    body: "수정과 영상은 업로드한 이미지를 먼저 보고 기준을 잡아.",
  },
  {
    icon: "grid",
    title: "규칙 적용",
    body: "유지할 것, 바꿀 것, 스타일 같은 조건을 정리해.",
  },
  {
    icon: "sparkle",
    title: "결과 생성",
    body: "최종 프롬프트가 이미지나 영상 엔진으로 넘어가.",
  },
];

const generateSteps: FlowStep[] = [
  {
    index: "01",
    title: "원하는 장면을 말로 적는다",
    simple: "예: 비 오는 골목에서 네온사인을 보는 여성.",
    detail:
      "처음 입력은 짧아도 괜찮아. 앱은 이 문장을 원본 요청으로 남겨두고, 별도의 최종 프롬프트를 만든다.",
    accent: "blue",
  },
  {
    index: "02",
    title: "캔버스 정보를 붙인다",
    simple: "선택한 비율과 해상도를 프롬프트 정리 단계에 같이 알려준다.",
    detail:
      "가로 사진인지, 세로 이미지인지, 정사각인지 알면 구도 표현이 덜 흔들려.",
    accent: "green",
  },
  {
    index: "03",
    title: "필요하면 조사 힌트를 더한다",
    simple: "Claude 프롬프트 조사를 켜면 스타일·조명 힌트가 참고자료로 붙는다.",
    detail:
      "이 힌트는 명령이 아니라 재료야. 원래 요청을 바꾸지 않고 표현을 풍부하게 만드는 데만 쓴다.",
    accent: "amber",
  },
  {
    index: "04",
    title: "이미지용 영어 프롬프트로 다듬는다",
    simple: "짧은 말이 조명, 구도, 질감, 분위기가 들어간 문장으로 바뀐다.",
    detail:
      "단, 오빠가 미니멀·심플 같은 표현을 쓰면 일부러 과한 디테일을 붙이지 않는다.",
    accent: "blue",
  },
  {
    index: "05",
    title: "확인한 프롬프트는 다시 쓰지 않는다",
    simple: "업그레이드 확인 모달에서 확정한 문장은 그대로 생성 단계로 간다.",
    detail:
      "이미 마음에 들게 고친 최종 문장을 다시 AI에게 맡기지 않아서 시간도 줄고 의미도 덜 바뀐다.",
    accent: "green",
  },
  {
    index: "06",
    title: "스타일과 금지어를 붙여 엔진에 보낸다",
    simple: "스타일 프리셋이 있으면 트리거 문구와 LoRA 설정이 함께 적용된다.",
    detail:
      "최종 영어 프롬프트는 positive로, 기본 품질 방지 문구는 negative로 들어간다.",
    accent: "amber",
  },
];

const editSteps: FlowStep[] = [
  {
    index: "01",
    title: "원본 요청을 받는다",
    simple: "예: 배경만 밤거리로 바꾸고 인물은 그대로 둬.",
    detail:
      "여기서는 오빠가 쓴 말을 그대로 보관해. 나중에 히스토리에는 이 원문도 같이 남아.",
    accent: "blue",
  },
  {
    index: "02",
    title: "수정 의도를 한 번 정리한다",
    simple: "느슨한 한국어 요청을 짧은 영어 지시로 바꾼다.",
    detail:
      "이 단계는 번역이 아니라 의도 정리야. 무엇을 바꿀지, 무엇을 유지할지 먼저 선명하게 만든다.",
    accent: "green",
  },
  {
    index: "03",
    title: "원본 이미지를 보고 구조를 나눈다",
    simple: "원본 사진을 보고 얼굴, 머리, 의상, 자세, 배경 같은 칸으로 나눈다.",
    detail:
      "인물 사진이면 인물용 칸을 쓰고, 물체나 풍경이면 물체·장면용 칸을 쓴다.",
    accent: "blue",
  },
  {
    index: "04",
    title: "바꿀 칸과 지킬 칸을 분리한다",
    simple: "바꿀 칸은 구체적으로 쓰고, 지킬 칸은 자세히 묘사하지 않는다.",
    detail:
      "보존할 내용을 너무 자세히 다시 쓰면 생성 엔진이 그 부분까지 새로 그릴 수 있어서, 그냥 '그대로 유지'라고만 보낸다.",
    accent: "amber",
  },
  {
    index: "05",
    title: "참조 이미지가 있으면 역할을 제한한다",
    simple: "image2는 얼굴, 의상, 배경, 스타일 중 지정한 역할만 가져온다.",
    detail:
      "예를 들어 의상 참조라면 image2의 옷만 가져오고, 얼굴이나 배경은 image1을 유지하도록 막는다.",
    accent: "green",
  },
  {
    index: "06",
    title: "최종 프롬프트를 한 번 더 점검한다",
    simple: "참조 이미지를 쓰는데 최종 문장에 image2가 빠지면 자동으로 보강한다.",
    detail:
      "이 안전장치 덕분에 참조 이미지를 올렸는데 프롬프트가 그 이미지를 무시하는 상황을 줄인다.",
    accent: "amber",
  },
  {
    index: "07",
    title: "생성 엔진에 넘긴다",
    simple: "최종 프롬프트와 image1, 필요하면 image2를 함께 ComfyUI로 보낸다.",
    detail:
      "결과에는 원본 요청, 최종 프롬프트, 한국어 번역, 분석 요약이 함께 저장된다.",
    accent: "blue",
  },
];

const preserveSlots = ["얼굴/표정", "머리", "의상", "몸/자세", "배경"];
const sceneSlots = ["주제", "색/재질", "구도", "배경/장소", "분위기"];

const videoSteps: FlowStep[] = [
  {
    index: "01",
    title: "첫 장면 이미지와 영상 요청을 받는다",
    simple: "예: 이 사진에서 카메라가 천천히 앞으로 다가가게 해줘.",
    detail:
      "영상은 텍스트만으로 시작하지 않고, 업로드한 이미지가 첫 프레임 기준점이 된다.",
    accent: "blue",
  },
  {
    index: "02",
    title: "이미 완성된 문장이면 보정을 건너뛴다",
    simple: "스킵 옵션을 켜면 오빠가 쓴 문장을 바로 최종 영상 프롬프트로 쓴다.",
    detail:
      "이 경우 이미지 분석과 프롬프트 보강을 생략해서 빠르지만, 직접 쓴 문장의 품질이 더 중요해진다.",
    accent: "amber",
  },
  {
    index: "03",
    title: "스킵하지 않으면 이미지를 먼저 본다",
    simple: "AI가 첫 장면의 인물, 배경, 조명, 구도를 요약한다.",
    detail:
      "이 요약이 있어야 영상이 시작부터 원본과 비슷하게 이어지고, 갑자기 다른 사람이나 장소로 튀는 걸 줄인다.",
    accent: "green",
  },
  {
    index: "04",
    title: "영상용 문장으로 다시 쓴다",
    simple: "움직임, 카메라, 조명 변화, 분위기를 한 문단으로 정리한다.",
    detail:
      "LTX 영상은 소리가 아니라 화면을 만드는 쪽이라, 음악이나 대사보다는 보이는 움직임을 중심으로 만든다.",
    accent: "blue",
  },
  {
    index: "05",
    title: "첫 프레임 보존 문구를 넣는다",
    simple: "같은 얼굴, 같은 인물, 같은 구도 같은 보존 문구가 중요하게 들어간다.",
    detail:
      "영상 생성에서 제일 위험한 건 인물이나 물체가 다른 모습으로 변하는 거라, 정체성 보존이 강하게 들어간다.",
    accent: "green",
  },
  {
    index: "06",
    title: "영상 엔진에 맞게 크기와 샘플링을 준비한다",
    simple: "원본 비율을 유지해 리사이즈하고, 5초짜리 영상 샘플링으로 넘긴다.",
    detail:
      "최종 프롬프트와 첫 이미지를 함께 넣고, 결과 MP4와 사용한 프롬프트를 히스토리에 저장한다.",
    accent: "amber",
  },
];

export default function PromptFlowPage() {
  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <StudioPage>
      <AppHeader />
      <main id="top" className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <div className={styles.kicker}>Prompt Flow Guide</div>
            <h1>프롬프트가 결과가 되기까지</h1>
            <p>
              복잡한 함수 이름 대신, 실제로는 어떤 생각의 순서로 프롬프트가
              정리되는지 보여주는 설명 페이지야. 수정 흐름을 제일 크게 다뤘어.
            </p>
          </div>
          <div className={styles.heroPreview} aria-label="페이지 구성 요약">
            <HeroFlowRow
              icon="image"
              title="생성"
              image="/menu/generate.png"
              onClick={() => scrollToSection("generate-flow")}
            />
            <HeroFlowRow
              icon="edit"
              title="수정"
              image="/menu/edit.png"
              onClick={() => scrollToSection("edit-flow")}
            />
            <HeroFlowRow
              icon="film"
              title="영상"
              image="/menu/video.png"
              onClick={() => scrollToSection("video-flow")}
            />
          </div>
        </section>

        <section className={styles.overview} aria-labelledby="overview-title">
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>한 줄 요약</span>
            <h2 id="overview-title">세 흐름은 같은 원리로 움직여</h2>
            <p>
              오빠의 말이 바로 엔진으로 가는 게 아니라, 목적에 맞게 정리되고
              필요한 이미지 정보가 붙은 뒤 최종 프롬프트로 넘어가.
            </p>
          </div>
          <div className={styles.journey}>
            {journey.map((step, idx) => (
              <div className={styles.journeyStep} key={step.title}>
                <div className={styles.journeyIcon}>
                  <Icon name={step.icon} size={18} />
                </div>
                <strong>{step.title}</strong>
                <span>{step.body}</span>
                {idx < journey.length - 1 && (
                  <div className={styles.journeyArrow} aria-hidden="true">
                    <Icon name="arrow-right" size={18} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <section
          id="generate-flow"
          className={styles.modeDetail}
          aria-labelledby="generate-title"
        >
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>Generate Flow</span>
            <h2 id="generate-title">이미지 생성은 이렇게 정리돼</h2>
            <p>
              생성은 원본 이미지가 없어서, 오빠가 쓴 문장을 좋은 촬영 지시문처럼
              다듬는 흐름이 중심이야.
            </p>
            <Link
              href="/prompt-flow/generate"
              style={{
                marginTop: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                fontWeight: 600,
                color: "var(--accent-ink)",
                textDecoration: "none",
                padding: "8px 14px",
                border: "1px solid var(--accent-ink)",
                borderRadius: 999,
                width: "fit-content",
              }}
            >
              <Icon name="grid" size={14} />
              분기 트리로 자세히 보기 (조건별 시뮬레이터)
              <Icon name="arrow-right" size={14} />
            </Link>
          </div>

          <div className={styles.modeDetailGrid}>
            <div className={styles.timeline}>
              {generateSteps.map((step) => (
                <StepCard step={step} key={step.index} />
              ))}
            </div>
            <aside className={styles.modeAside}>
              <VisualModeCard
                icon="image"
                title="이미지 생성"
                image="/menu/generate.png"
              />
              <div className={styles.ruleBlock}>
                <h3>생성에서 바뀌는 것</h3>
                <p>
                  짧은 요청이 구도, 카메라 느낌, 조명, 질감이 포함된 영어
                  프롬프트로 바뀐다.
                </p>
              </div>
              <div className={styles.ruleBlock}>
                <h3>다시 보강하지 않는 경우</h3>
                <p>
                  오빠가 확인 모달에서 고친 최종 프롬프트는 그대로 사용해.
                  그래서 의도치 않은 재해석을 줄인다.
                </p>
              </div>
            </aside>
          </div>

          <GenerateUseCaseDiagram />

          <div className={styles.exampleFlow}>
            <ExampleCard label="오빠 입력" text="비 오는 골목의 네온 감성." />
            <ExampleCard
              label="추가 맥락"
              text="세로 이미지라면 인물 중심 구도, 가로 이미지라면 배경 공간을 더 넓게 잡도록 알려준다."
            />
            <ExampleCard
              label="정리된 프롬프트"
              text="A cinematic rainy alley scene with neon reflections, wet pavement, moody lighting, and a clear subject-focused composition."
            />
            <ExampleCard
              label="엔진 전달"
              text="최종 영어 문장 + 선택한 스타일 + 기본 negative prompt가 함께 들어간다."
            />
          </div>
        </section>

        <section
          id="edit-flow"
          className={styles.editFocus}
          aria-labelledby="edit-title"
        >
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>Main Focus</span>
            <h2 id="edit-title">이미지 수정은 이렇게 움직여</h2>
            <p>
              핵심은 “어디를 바꿀지”보다 “어디를 건드리면 안 되는지”까지
              같이 정리하는 거야.
            </p>
          </div>

          <div className={styles.editGrid}>
            <div className={styles.timeline}>
              {editSteps.map((step) => (
                <StepCard step={step} key={step.index} />
              ))}
            </div>

            <aside className={styles.sidePanel} aria-label="수정 흐름 핵심 규칙">
              <div className={styles.ruleBlock}>
                <h3>분석표는 이렇게 생겼어</h3>
                <p>
                  AI가 원본을 보고 5칸짜리 표로 나눠. 각 칸에는
                  <b> 바꿈</b> 또는 <b>유지</b>가 붙어.
                </p>
                <div className={styles.slotColumns}>
                  <SlotList title="인물 사진" items={preserveSlots} />
                  <SlotList title="물체·풍경" items={sceneSlots} />
                </div>
              </div>

              <div className={styles.ruleBlock}>
                <h3>참조 이미지가 있을 때</h3>
                <div className={styles.referenceRows}>
                  <ReferenceRule label="얼굴" text="얼굴 정체성만 image2에서 가져와." />
                  <ReferenceRule label="의상" text="옷과 액세서리만 가져와." />
                  <ReferenceRule label="배경" text="배경만 image2 환경으로 바꿔." />
                  <ReferenceRule label="스타일" text="색감과 조명 분위기만 맞춰." />
                </div>
              </div>

              <div className={styles.ruleBlock}>
                <h3>가장 중요한 안전장치</h3>
                <p>
                  “유지” 칸은 자세히 묘사하지 않고, “그대로 유지”라고만 말해.
                  그래야 원본의 멀쩡한 부분을 다시 그리는 실수를 줄일 수 있어.
                </p>
              </div>
            </aside>
          </div>
        </section>

        <section className={styles.example} aria-labelledby="example-title">
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>예시</span>
            <h2 id="example-title">프롬프트가 실제로 변하는 느낌</h2>
          </div>
          <div className={styles.exampleFlow}>
            <ExampleCard
              label="오빠 입력"
              text="배경만 밤거리로 바꾸고, 인물 얼굴이랑 옷은 그대로 둬."
            />
            <ExampleCard
              label="정리된 의도"
              text="Change only the background to a night city street. Keep the person, face, and clothing unchanged."
            />
            <ExampleCard
              label="분석표"
              text="얼굴 유지 · 의상 유지 · 자세 유지 · 배경 바꿈"
            />
            <ExampleCard
              label="최종 프롬프트"
              text="Replace only the background with a realistic night city street while preserving the same person, face, clothing, pose, lighting balance, and all unchanged details from image1."
            />
          </div>
        </section>

        <section
          id="video-flow"
          className={styles.modeDetail}
          aria-labelledby="video-title"
        >
          <div className={styles.sectionHead}>
            <span className={styles.sectionEyebrow}>Video Flow</span>
            <h2 id="video-title">영상 생성은 첫 장면을 붙잡고 움직임을 만든다</h2>
            <p>
              영상은 프롬프트만 보는 게 아니라, 업로드한 이미지를 첫 프레임처럼
              보고 그 상태에서 어떤 움직임을 줄지 정리해.
            </p>
          </div>

          <div className={styles.modeDetailGrid}>
            <div className={styles.timeline}>
              {videoSteps.map((step) => (
                <StepCard step={step} key={step.index} />
              ))}
            </div>
            <aside className={styles.modeAside}>
              <VisualModeCard
                icon="film"
                title="영상 생성"
                image="/menu/video.png"
              />
              <div className={styles.ruleBlock}>
                <h3>영상에서 제일 중요한 것</h3>
                <p>
                  첫 이미지의 얼굴, 피사체, 구도가 유지돼야 해. 그래서 움직임보다
                  정체성 보존 문구가 먼저 잡힌다.
                </p>
              </div>
              <div className={styles.ruleBlock}>
                <h3>스킵 옵션의 의미</h3>
                <p>
                  스킵을 켜면 빠르지만, 이미지 분석과 프롬프트 보강을 거치지
                  않아. 이미 잘 쓴 영어 영상 프롬프트일 때 쓰는 옵션이야.
                </p>
              </div>
            </aside>
          </div>
          <div className={styles.exampleFlow}>
            <ExampleCard label="오빠 입력" text="카메라가 천천히 앞으로 다가가게 해줘." />
            <ExampleCard
              label="이미지 이해"
              text="첫 장면의 인물, 표정, 배경, 조명 상태를 먼저 요약한다."
            />
            <ExampleCard
              label="영상 프롬프트"
              text="A slow cinematic dolly-in toward the same subject, preserving the face, pose, lighting, and first-frame composition."
            />
            <ExampleCard
              label="결과 저장"
              text="MP4 결과와 최종 영상 프롬프트, 한국어 번역, 이미지 설명이 히스토리에 남는다."
            />
          </div>
        </section>

        <button
          type="button"
          className={styles.topButton}
          onClick={() => scrollToSection("top")}
          title="맨 위로"
          aria-label="맨 위로 이동"
        >
          <Icon name="chevron-down" size={18} />
          TOP
        </button>
      </main>
    </StudioPage>
  );
}

function StepCard({ step }: { step: FlowStep }) {
  return (
    <article className={`${styles.stepCard} ${styles[step.accent]}`}>
      <div className={styles.stepIndex}>{step.index}</div>
      <div className={styles.stepCopy}>
        <h3>{step.title}</h3>
        <p className={styles.simple}>{step.simple}</p>
        <p>{step.detail}</p>
      </div>
    </article>
  );
}

function GenerateUseCaseDiagram() {
  return (
    <section className={styles.ucSection} aria-labelledby="generate-uc-title">
      <div className={styles.ucSectionHead}>
        <span className={styles.sectionEyebrow}>Graphic View</span>
        <h3 id="generate-uc-title">생성 모드 변환 다이어그램 (Use Case 스타일)</h3>
        <p>
          위 단계 카드가 문자 기준 설명이라면, 이 다이어그램은 같은 흐름을
          그래픽 기준으로 보여줘. 실선은 기본 흐름이고 점선은 조건부로 붙는
          확장 분기야.
        </p>
      </div>

      <div className={styles.ucBoundary}>
        <span className={styles.ucBoundaryLabel}>uc Generate Pipeline</span>
        <div className={styles.ucTitle}>System Boundary</div>

        <div className={styles.ucDiagramWrap}>
          <div className={styles.ucExtendRow}>
            <UcExtendNode
              label="한글 → 영어 번역"
              condition="한글 입력일 때"
              colorClass={styles.ucColorPurple}
              sysPrompt="SYSTEM_GENERATE"
            />
            <UcExtendNode
              label="조사 힌트 흡수"
              condition="Claude 조사 ON"
              colorClass={styles.ucColorGreen}
              sysPrompt="data-only hints"
            />
            <UcExtendNode
              label="미니멀 모드"
              condition="미니멀 키워드"
              colorClass={styles.ucColorAmber}
              sysPrompt="minimal branch"
            />
            <UcExtendNode
              label="보강 호출 스킵"
              condition="사전 확정 프롬프트"
              colorClass={styles.ucColorRose}
              sysPrompt="pre-confirmed"
            />
          </div>

          <div className={styles.ucMainRow}>
            <UcMainNode
              number="01"
              label="사용자 입력"
              desc="원본 prompt"
              colorClass={styles.ucColorPurple}
            />
            <span className={styles.ucMainArrow} aria-hidden="true">→</span>
            <UcMainNode
              number="02"
              label="프롬프트 보강"
              desc="영어 생성 지시문"
              colorClass={styles.ucColorInk}
              sysPrompt="gemma4"
            />
            <span className={styles.ucMainArrow} aria-hidden="true">→</span>
            <UcMainNode
              number="03"
              label="캔버스 결합"
              desc="비율·해상도"
              colorClass={styles.ucColorAmber}
            />
            <span className={styles.ucMainArrow} aria-hidden="true">→</span>
            <UcMainNode
              number="04"
              label="ComfyUI 전달"
              desc="prompt + LoRA + seed"
              colorClass={styles.ucColorBlue}
              sysPrompt="flat API"
            />
            <span className={styles.ucMainArrow} aria-hidden="true">→</span>
            <UcMainNode
              number="05"
              label="이미지 결과"
              desc="히스토리 저장"
              colorClass={styles.ucColorCyan}
            />
          </div>

          <div className={styles.ucExtendRow}>
            <UcExtendNode
              label="Lightning"
              condition="빠른 생성"
              colorClass={styles.ucColorBlue}
              sysPrompt="steps 8 · cfg 1.5"
            />
            <UcExtendNode
              label="Style LoRA"
              condition="스타일 프리셋"
              colorClass={styles.ucColorCyan}
              sysPrompt="trigger + override"
            />
            <UcExtendNode
              label="기본 샘플링"
              condition="스타일 OFF"
              colorClass={styles.ucColorRose}
              sysPrompt="default sampling"
            />
          </div>

          <svg
            className={styles.ucSvgOverlay}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {[12, 32, 56, 78].map((leftPct) => (
              <line
                key={`top-${leftPct}`}
                x1={leftPct}
                y1="22"
                x2="30"
                y2="42"
                stroke="#9aa3b2"
                strokeWidth="0.4"
                strokeDasharray="0.8 0.6"
                opacity="0.55"
              />
            ))}
            {[20, 50, 80].map((leftPct) => (
              <line
                key={`bottom-${leftPct}`}
                x1={leftPct}
                y1="78"
                x2="70"
                y2="58"
                stroke="#9aa3b2"
                strokeWidth="0.4"
                strokeDasharray="0.8 0.6"
                opacity="0.55"
              />
            ))}
          </svg>
        </div>

        <div className={styles.ucActorRow}>
          <span className={styles.ucActorRoleLabel}>외부 액터</span>
          <span className={styles.ucActor}>사용자</span>
          <span className={styles.ucActor}>Ollama gemma4</span>
          <span className={styles.ucActor}>Claude 조사</span>
          <span className={styles.ucActor}>ComfyUI</span>
        </div>
      </div>
    </section>
  );
}

function UcMainNode({
  number,
  label,
  desc,
  colorClass,
  sysPrompt,
}: {
  number: string;
  label: string;
  desc: string;
  colorClass: string;
  sysPrompt?: string;
}) {
  return (
    <div className={`${styles.ucMainNode} ${colorClass}`}>
      <div className={styles.ucMainNumber}>{number}</div>
      <div className={styles.ucMainLabel}>{label}</div>
      <p className={styles.ucMainDesc}>{desc}</p>
      {sysPrompt && <span className={styles.ucSysPrompt}>{sysPrompt}</span>}
    </div>
  );
}

function UcExtendNode({
  label,
  condition,
  colorClass,
  sysPrompt,
}: {
  label: string;
  condition: string;
  colorClass: string;
  sysPrompt: string;
}) {
  return (
    <div className={`${styles.ucExtendNode} ${colorClass}`}>
      <span className={styles.ucExtendTagBadge}>&lt;&lt;extend&gt;&gt;</span>
      <span className={styles.ucExtendLabel}>{label}</span>
      <span className={styles.ucExtendCondition}>{`{${condition}}`}</span>
      <span className={styles.ucSysPrompt}>{sysPrompt}</span>
    </div>
  );
}

function HeroFlowRow({
  icon,
  title,
  image,
  onClick,
}: {
  icon: IconName;
  title: string;
  image: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.heroFlowRow}
      onClick={onClick}
      title={`${title} 흐름으로 이동`}
      style={{
        backgroundImage: `linear-gradient(180deg, rgba(31,31,31,.05), rgba(31,31,31,.62)), url(${image})`,
      }}
    >
      <div className={styles.heroFlowTitle}>
        <Icon name={icon} size={18} />
        <strong>{title}</strong>
      </div>
    </button>
  );
}

function SlotList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className={styles.slotList}>
      <strong>{title}</strong>
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
    </div>
  );
}

function ReferenceRule({ label, text }: { label: string; text: string }) {
  return (
    <div className={styles.referenceRule}>
      <span>{label}</span>
      <p>{text}</p>
    </div>
  );
}

function ExampleCard({ label, text }: { label: string; text: string }) {
  return (
    <article className={styles.exampleCard}>
      <span>{label}</span>
      <p>{text}</p>
    </article>
  );
}

function VisualModeCard({
  icon,
  title,
  image,
}: {
  icon: IconName;
  title: string;
  image: string;
}) {
  return (
    <article className={styles.visualModeCard}>
      <div
        className={styles.summaryMedia}
        style={{ backgroundImage: `linear-gradient(90deg, rgba(31,31,31,.58), rgba(31,31,31,.16)), url(${image})` }}
      >
        <Icon name={icon} size={24} />
        <h3>{title}</h3>
      </div>
    </article>
  );
}
