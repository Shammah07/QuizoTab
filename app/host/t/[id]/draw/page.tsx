import { SpectatorPage } from "@/components/host/spectator-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Draw" };

export default async function Page({ params, searchParams }: PageProps<"/host/t/[id]/draw">) {
  const { id } = await params;
  const { room } = await searchParams;
  return <SpectatorPage accessKey={id} section="draw" room={room} />;
}
