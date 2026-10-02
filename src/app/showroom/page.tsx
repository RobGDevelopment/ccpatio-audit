import { loadShowroomPortal } from "@/server/showroom/load-portal";
import { ShowroomPortal } from "./ShowroomPortal";

export const dynamic = "force-dynamic";

export default async function ShowroomPage() {
  const data = await loadShowroomPortal();
  if (!data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#FAFAFA] px-6 text-slate-700">
        Sign in to open the showroom.
      </main>
    );
  }

  return (
    <ShowroomPortal
      email={data.session.email}
      orders={data.orders}
      finishedGoods={data.finishedGoods}
      fabrics={data.fabrics}
    />
  );
}
