// The branded public view runs outside the app chrome (no mesh, no nav,
// no workspace switcher). Its page component sources every surface detail
// from the workspace record keyed off the share token in the URL, so we
// just want a clean white canvas here.
export default function BrandedLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-white">{children}</div>;
}
