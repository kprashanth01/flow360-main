import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BrainCircuit,
  Database,
  FileText,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";

const workflowSteps = ["Ingest", "Retrieve", "Analyze", "Recommend", "Review"];

const platformCards = [
  "Upload transcripts, emails, CRM notes, PDFs, and playbooks.",
  "Retrieve semantic, episodic, profile, and rule memory from Supabase.",
  "Explain each recommendation with source-backed evidence.",
  "Learn from accept/reject feedback after human review.",
];

const architectureCards = [
  ["Planner", "Coordinates specialist agents without overcomplicating orchestration."],
  ["Retriever", "Uses LlamaIndex chunking and Supabase pgvector context search."],
  ["Recommender", "Produces owner, due date, confidence, rationale, and evidence."],
  ["Memory", "Stores interaction, profile, rule, and human feedback memory."],
];

function DashboardPreview() {
  return (
    <div className="hero-preview mx-auto w-full max-w-5xl overflow-hidden rounded-t-xl border border-white/16 bg-black/42 text-left shadow-[0_-22px_90px_rgba(14,165,233,0.16)] backdrop-blur-md">
      <div className="grid min-h-[250px] grid-cols-[170px_1fr] sm:grid-cols-[220px_1fr]">
        <aside className="border-r border-white/10 bg-white/[0.055] p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles size={16} />
            Flow360
          </div>
          <div className="mt-6 grid gap-2 text-xs text-white/62">
            {["Overview", "Inbox", "Memory"].map((item, index) => (
              <div
                key={item}
                className={`flex h-9 items-center gap-2 rounded-md px-3 ${
                  index === 0 ? "bg-white/12 text-white" : ""
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
                {item}
              </div>
            ))}
          </div>
        </aside>

        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase text-cyan-200/70">Planner Run</p>
              <h3 className="mt-1 text-xl font-semibold text-white">Renewal Risk Decision Case</h3>
            </div>
            <div className="hidden h-9 w-52 items-center rounded-md border border-white/10 bg-white/10 px-3 text-xs text-white/45 md:flex">
              Search context
            </div>
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-lg border border-white/10 bg-white/[0.055] p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Next Best Actions</p>
                <span className="rounded-md bg-emerald-400/14 px-2 py-1 text-xs text-emerald-100">
                  Review
                </span>
              </div>
              <div className="mt-4 space-y-3">
                {[
                  ["Escalate credentialing", "89%", "5 days to start"],
                  ["Send CFO approval brief", "84%", "premium-rate risk"],
                  ["Book renewal check-in", "82%", "SLA history"],
                ].map(([title, confidence, detail]) => (
                  <div
                    key={title}
                    className="grid grid-cols-[1fr_auto] gap-3 rounded-md border border-white/8 bg-black/28 p-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-white">{title}</p>
                      <p className="mt-1 text-xs text-white/48">{detail}</p>
                    </div>
                    <p className="text-sm font-semibold text-cyan-200">{confidence}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.055] p-4">
              <p className="text-sm font-semibold text-white">Agent Decision Flow</p>
              <div className="mt-4 grid gap-3">
                {[
                  [FileText, "Signals parsed", "meeting + email + CRM"],
                  [BrainCircuit, "Planner routed", "retrieval, analysis, memory"],
                  [UserCheck, "Review queued", "owner: Account Manager"],
                ].map(([Icon, title, detail]) => (
                  <div key={title as string} className="flex items-start gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-cyan-300/12 text-cyan-200">
                      <Icon size={16} />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-white">{title as string}</p>
                      <p className="text-xs text-white/48">{detail as string}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="apple-landing relative isolate min-h-screen overflow-hidden text-white">
      <section className="relative min-h-screen overflow-visible px-4 py-5 sm:px-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-2 hidden text-center text-[13rem] font-semibold leading-none text-white/[0.045] xl:text-[15rem] lg:block"
        >
          FLOW360
        </div>

        <div className="hero-device-frame relative z-10 mx-auto flex min-h-[calc(100vh-40px)] max-w-[1280px] flex-col overflow-hidden rounded-[30px] border border-white/14 bg-black/24 shadow-[0_0_80px_rgba(14,165,233,0.12)] backdrop-blur-[2px]">
          <nav className="relative z-20 flex items-center justify-between px-5 py-5 lg:px-28">
            <Link href="/" className="flex items-center gap-3" aria-label="Flow360 home">
              <span className="flex h-10 w-10 items-center justify-center rounded-md border border-white/14 bg-white/10">
                <Sparkles size={18} />
              </span>
              <span className="text-xl font-semibold tracking-normal">Flow360</span>
            </Link>

            <div className="hidden items-center gap-1 rounded-full border border-white/18 bg-black/42 p-1 text-sm text-white/78 shadow-[inset_0_1px_18px_rgba(255,255,255,0.08)] backdrop-blur md:flex">
              <a href="#platform" className="rounded-full px-5 py-3 transition hover:bg-white/10 hover:text-white">
                Platform
              </a>
              <a href="#workflow" className="rounded-full px-5 py-3 transition hover:bg-white/10 hover:text-white">
                Workflow
              </a>
              <a href="#architecture" className="rounded-full px-5 py-3 transition hover:bg-white/10 hover:text-white">
                Architecture
              </a>
            </div>

            <Link
              href="/app"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-md border border-white/18 bg-black px-4 text-sm font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.55)] transition hover:bg-white hover:text-black"
            >
              <span className="hidden sm:inline">Get Started</span>
              <ArrowRight size={16} />
            </Link>
          </nav>

          <div className="relative flex flex-1 flex-col items-center px-5 pb-0 pt-20 text-center sm:pt-24">
            <span aria-hidden className="hero-horizon" />

            <div className="relative z-10 rounded-full border border-white/12 bg-white/10 px-4 py-2 text-sm text-white/74 backdrop-blur">
              Agentic decision intelligence for company workspaces
            </div>
            <h1 className="relative z-10 mt-7 flex max-w-5xl flex-col text-5xl font-semibold leading-[1.05] tracking-normal text-white drop-shadow-[0_8px_28px_rgba(0,0,0,0.62)] sm:text-6xl lg:text-7xl">
              <span>Decision intelligence</span>
              <span>powered by memory</span>
            </h1>
            <p className="relative z-10 mt-6 max-w-2xl text-base leading-7 text-white/78 sm:text-lg">
              Turn meetings, CRM updates, emails, policies, notes, and prior decisions into explainable next best actions with evidence and human approval.
            </p>
            <div className="relative z-10 mt-9">
              <Link
                href="/app"
                className="inline-flex h-12 items-center gap-2 rounded-md border border-white/16 bg-black px-5 text-sm font-semibold text-white shadow-[0_0_22px_rgba(59,130,246,0.55)] transition hover:bg-white hover:text-black"
              >
                Get Started
                <ArrowRight size={17} />
              </Link>
            </div>

            <div className="relative z-10 mt-auto w-full px-0 pt-16 sm:px-6 lg:px-12">
              <DashboardPreview />
            </div>
          </div>
        </div>
      </section>

      <section id="platform" className="landing-section relative -mt-14 overflow-hidden px-5 pb-24 pt-44 text-white">
        <div aria-hidden className="section-aurora section-aurora-top" />
        <div className="relative z-10 mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase text-cyan-300">Reusable Platform</p>
            <h2 className="mt-3 max-w-2xl text-4xl font-semibold tracking-normal">Decision intelligence infrastructure, not another chatbot.</h2>
            <p className="mt-4 text-base leading-7 text-white/64">
              Flow360 gives the jury a real platform story: dynamic planner orchestration, shared memory, retrieval, explainability, and human-in-the-loop review.
            </p>
            <div className="mt-7 grid max-w-xl grid-cols-3 gap-2 text-sm">
              {["Planner", "Evidence", "Memory"].map((item) => (
              <div key={item} className="cosmic-chip rounded-md border px-3 py-3 font-medium">
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {platformCards.map((text) => (
              <div key={text} className="cosmic-panel rounded-lg p-4">
                <p className="text-sm leading-6 text-white/68">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="landing-section relative overflow-hidden px-5 pb-24 pt-20 text-white">
        <div aria-hidden className="section-aurora section-aurora-mid" />
        <div className="relative z-10 mx-auto max-w-7xl">
          <p className="text-sm font-semibold uppercase text-cyan-300">Agent Workflow</p>
          <h2 className="mt-3 max-w-3xl text-4xl font-semibold tracking-normal">One polished operating loop for enterprise decisions.</h2>
          <div className="mt-8 grid gap-3 lg:grid-cols-5">
            {workflowSteps.map((step, index) => (
              <div key={step} className="cosmic-panel cosmic-step rounded-lg p-5">
                <p className="text-sm font-semibold text-cyan-200/70">0{index + 1}</p>
                <p className="mt-8 text-lg font-semibold">{step}</p>
                <p className="mt-2 text-sm leading-6 text-white/56">
                  {[
                    "Capture customer interactions.",
                    "Gather enterprise context.",
                    "Find risk and opportunity.",
                    "Rank next best actions.",
                    "Store reviewer feedback.",
                  ][index]}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="architecture" className="landing-section relative overflow-hidden px-5 pb-20 pt-6 text-white">
        <div aria-hidden className="section-aurora section-aurora-bottom" />
        <div className="relative z-10 mx-auto max-w-7xl">
          <p className="text-sm font-semibold uppercase text-cyan-300">Architecture</p>
          <h2 className="mt-3 max-w-3xl text-4xl font-semibold tracking-normal">LangGraph planner, LlamaIndex retrieval, Groq reasoning, Supabase memory.</h2>
          <div className="mt-8 grid gap-3 lg:grid-cols-4">
            {architectureCards.map(([title, text]) => (
              <div key={title} className="cosmic-panel rounded-lg p-5">
                <p className="font-semibold">{title}</p>
                <p className="mt-3 text-sm leading-6 text-white/58">{text}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 grid gap-3 lg:grid-cols-3">
            {[
              [Database, "Live memory", "Supabase stores documents, chunks, reviews, and agent runs."],
              [BadgeCheck, "Evidence first", "Every action includes rationale, source snippets, and confidence."],
              [ShieldCheck, "Human approval", "Recommendations are reviewed before acceptance or execution."],
            ].map(([Icon, title, text]) => (
              <div key={title as string} className="cosmic-panel flex items-start gap-3 rounded-lg p-5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/10 text-cyan-200">
                  <Icon size={17} />
                </span>
                <div>
                  <p className="font-semibold">{title as string}</p>
                  <p className="mt-2 text-sm leading-6 text-white/58">{text as string}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
