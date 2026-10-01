export default function EmbedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">{children}</div>
  );
}
