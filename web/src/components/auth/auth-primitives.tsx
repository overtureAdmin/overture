import { ReactNode } from "react";

export function AuthShell(props: { children: ReactNode; aside: ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f5f2f8] px-4 py-4 sm:px-5 sm:py-5 lg:px-8 lg:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_12%,rgba(125,78,173,0.10),transparent_34%),radial-gradient(circle_at_88%_16%,rgba(166,133,205,0.12),transparent_28%),linear-gradient(180deg,#f8f6fa_0%,#f2eef6_100%)]" />
        <div className="absolute left-[-9rem] top-[-6rem] h-72 w-72 rounded-full bg-[#e8dcf5] opacity-70 blur-3xl" />
        <div className="absolute bottom-[-8rem] right-[12%] h-72 w-72 rounded-full bg-[#ece4f8] opacity-80 blur-3xl" />
      </div>
      <div className="relative mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1320px] grid-cols-1 gap-6 lg:grid-cols-[0.86fr_1.14fr] lg:items-center lg:gap-10">
        {props.aside}
        {props.children}
      </div>
    </main>
  );
}

export function AuthAside(props: { children: ReactNode }) {
  return (
    <section className="order-2 relative overflow-hidden rounded-[28px] border border-white/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.84),rgba(248,244,252,0.72))] p-6 shadow-[0_18px_48px_rgba(53,28,78,0.06)] backdrop-blur-[6px] md:p-8 lg:order-1 lg:min-h-[640px] lg:p-10">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(139,49,199,0.12),transparent_34%)]" />
      <div className="relative h-full">{props.children}</div>
    </section>
  );
}

export function AuthPanel(props: { children: ReactNode }) {
  return <section className="order-1 flex min-h-full items-center justify-center lg:order-2 lg:justify-end">{props.children}</section>;
}

export function AuthCard(props: { children: ReactNode }) {
  return (
    <section className="relative w-full max-w-[470px] overflow-hidden rounded-[24px] border border-[#e3dbe9] bg-[rgba(255,255,255,0.96)] p-5 shadow-[0_24px_60px_rgba(41,20,64,0.10)] backdrop-blur md:p-7">
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(139,49,199,0.07),transparent)]" />
      <div className="relative">{props.children}</div>
    </section>
  );
}

export function AuthKicker(props: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#866b9d]">{props.children}</p>;
}

export function AuthHeading(props: { title: string; body: string }) {
  return (
    <header>
      <h1 className="heading-display mt-2 text-[2rem] text-[#281434] md:text-[2.3rem] md:leading-[1.08]">
        {props.title}
      </h1>
      <p className="mt-3 max-w-xl text-[14px] leading-6 text-[#665b72]">{props.body}</p>
    </header>
  );
}

export function AuthField(props: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-medium tracking-[0.01em] text-[#3f304d]">{props.label}</span>
      {props.children}
      {props.hint ? <span className="mt-2 block text-[12px] leading-5 text-[#7a6d87]">{props.hint}</span> : null}
    </label>
  );
}

export function AuthInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`calm-input h-[50px] w-full px-4 text-[14px] ${props.className ?? ""}`.trim()} />;
}

export function AuthSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`calm-input h-[50px] w-full px-4 text-[14px] ${props.className ?? ""}`.trim()} />;
}

export function AuthTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`calm-input w-full resize-none px-4 py-3 text-[14px] ${props.className ?? ""}`.trim()} />;
}

export function AuthPrimaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`calm-primary inline-flex h-[50px] items-center justify-center rounded-[16px] px-6 text-[14px] font-semibold shadow-[0_14px_34px_rgba(139,49,199,0.22)] ${props.className ?? ""}`.trim()}
    />
  );
}

export function AuthSecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`calm-ghost inline-flex h-[50px] items-center justify-center rounded-[16px] px-6 text-[14px] font-medium ${props.className ?? ""}`.trim()}
    />
  );
}

export function AuthLinkButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`text-[13px] font-medium text-[#8b31c7] transition-colors duration-200 hover:text-[#9b3fe8] disabled:cursor-not-allowed disabled:text-[#998aa8] ${props.className ?? ""}`.trim()}
    />
  );
}

export function AuthAlert(props: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const styles =
    props.tone === "error"
      ? "border-[#f1c8d1] bg-[#fff7f8] text-[#9d3346]"
      : props.tone === "success"
        ? "border-[#ded0ea] bg-[#faf6fd] text-[#55356f]"
        : "border-[#e4dbeb] bg-[#fcfbfd] text-[#645670]";
  return <div className={`rounded-[18px] border px-4 py-3 text-[13px] leading-5 ${styles}`}>{props.children}</div>;
}

export function AuthProgress(props: { steps: Array<{ key: string; label: string }>; currentKey: string }) {
  const currentIndex = Math.max(0, props.steps.findIndex((step) => step.key === props.currentKey));
  return (
    <div className="rounded-[18px] border border-[#e8e1ec] bg-[#faf8fb] p-3">
      <div className="flex flex-wrap gap-2">
        {props.steps.map((step, index) => {
          const active = step.key === props.currentKey;
          const complete = index < currentIndex;
          return (
            <div
              key={step.key}
              className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition-colors duration-200 ${
                active
                  ? "border-[#cfbfde] bg-[#f0eaf6] text-[#4b365d]"
                  : complete
                    ? "border-[#ddd3e6] bg-white text-[#62546f]"
                    : "border-[#ece6f1] bg-white/70 text-[#94869f]"
              }`}
            >
              <span
                className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] ${
                  active ? "bg-[#8b31c7] text-white" : complete ? "bg-[#e5dceb] text-[#58486a]" : "bg-[#f3eef6] text-[#8c7d99]"
                }`}
              >
                {index + 1}
              </span>
              {step.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AuthLegalCard(props: { title: string; paragraphs: string[] }) {
  return (
    <div className="rounded-[20px] border border-[#e5dde9] bg-[#fcfbfd] p-5">
      <h3 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#5a4969]">{props.title}</h3>
      <div className="mt-3 max-h-56 space-y-3 overflow-y-auto pr-2 text-[13px] leading-6 text-[#61556d]">
        {props.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </div>
  );
}
