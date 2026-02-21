export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6">
      <h1 className="text-3xl font-semibold">Unity Appeals</h1>
      <p className="mt-2 text-sm text-zinc-600">Sign in to access your case workspace.</p>
      <form className="mt-8 space-y-4 rounded-xl border border-zinc-200 p-5">
        <label className="block text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          className="w-full rounded-md border border-zinc-300 px-3 py-2"
          placeholder="name@company.com"
        />
        <label className="block text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="w-full rounded-md border border-zinc-300 px-3 py-2"
          placeholder="********"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white"
        >
          Continue
        </button>
      </form>
    </main>
  );
}
