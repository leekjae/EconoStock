import { useState } from "react";
import { ArrowRight, BarChart3, CandlestickChart, Database, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

import { HomeDashboard } from "@/components/market/HomeDashboard";
import { ScreeningMonitor } from "@/components/screening/ScreeningMonitor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBusinessDate } from "@/hooks/useKrxData";

type WorkspaceView = "overview" | "screening";

function formatBusinessDate(value: string | null | undefined) {
  if (!value || !/^\d{8}$/.test(value)) {
    return value || "-";
  }

  return `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`;
}

const VIEW_ITEMS: Array<{
  id: WorkspaceView;
  label: string;
  description: string;
  icon: typeof BarChart3;
}> = [
  {
    id: "overview",
    label: "개요",
    description: "시장 스냅샷과 현재 스크리닝 작업공간 상태를 확인합니다.",
    icon: BarChart3,
  },
  {
    id: "screening",
    label: "스크리닝 성과",
    description: "적재된 스크리닝 run과 다음날 시가 기준 현재 성과를 확인합니다.",
    icon: Database,
  },
];

export default function Workspace() {
  const [selectedView, setSelectedView] = useState<WorkspaceView>("overview");
  const { data: latestDate, isLoading: dateLoading } = useBusinessDate();

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#f5f8ff_0%,#ffffff_45%)]">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 lg:px-6">
        <header className="overflow-hidden rounded-[28px] border border-slate-200 bg-white/90 shadow-sm backdrop-blur">
          <div className="grid gap-6 px-6 py-7 lg:grid-cols-[minmax(0,1fr),320px] lg:px-8">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">GitHub + Supabase</Badge>
                {latestDate ? <Badge variant="secondary">기준 영업일 {formatBusinessDate(latestDate)}</Badge> : null}
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-slate-950 lg:text-4xl">
                  EconoStock 스크리닝 워크스페이스
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-slate-600 lg:text-base">
                  메인 화면은 스크리닝 결과 검토와 성과 모니터링에 집중합니다. 테마 탐색과 보조 도구는 레거시
                  콘솔로 분리해, 루트 화면은 더 가볍고 명확하게 유지합니다.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {VIEW_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.id === selectedView;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedView(item.id)}
                      className={`flex min-w-[180px] items-start gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                        isActive
                          ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white"
                      }`}
                    >
                      <div className={`rounded-xl p-2 ${isActive ? "bg-white/15" : "bg-white"}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold">{item.label}</p>
                        <p className={`mt-1 text-xs leading-5 ${isActive ? "text-slate-200" : "text-slate-500"}`}>
                          {item.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-white p-2 shadow-sm">
                  <CandlestickChart className="h-5 w-5 text-slate-700" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">운영 메모</p>
                  <p className="text-xs text-slate-500">메인 화면은 스크리닝 중심으로 단순화했고, 나머지는 레거시에 남겨뒀습니다.</p>
                </div>
              </div>
              <div className="mt-4 space-y-3 text-sm text-slate-600">
                <p>1. 메인 워크스페이스는 스크리닝 run과 성과 모니터링에 집중합니다.</p>
                <p>2. 새로고침 시 Supabase 결과와 KRX 가격 기준이 함께 갱신됩니다.</p>
                <p>3. 테마 브라우저와 보조 도구는 레거시 콘솔에서 계속 사용할 수 있습니다.</p>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button asChild variant="outline">
                  <Link to="/legacy">
                    레거시 콘솔
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button onClick={() => setSelectedView("screening")}>
                  성과 보드 열기
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </header>

        {selectedView === "overview" ? (
          <div className="space-y-6">
            <section className="grid gap-4 lg:grid-cols-2">
              <OverviewCard
                title="스크리닝 성과"
                description="적재된 run, 진입 시가, 최신 종가 기준 수익률을 한 곳에서 추적합니다."
                actionLabel="열기"
                onClick={() => setSelectedView("screening")}
              />
              <OverviewCard
                title="레거시 도구"
                description="테마 브라우저와 평균단가 계산기는 legacy 콘솔에서 계속 사용할 수 있습니다."
                actionLabel="legacy로 이동"
                onClick={() => {
                  window.location.assign("/legacy");
                }}
              />
            </section>

            <Card className="overflow-hidden border-slate-200 bg-white/95 shadow-sm">
              <CardHeader className="border-b border-slate-100 bg-slate-50/80">
                <CardTitle className="text-xl">시장 스냅샷</CardTitle>
                <CardDescription>
                  홈 화면에는 핵심 시장 흐름만 남기고, 확장 탐색 기능은 레거시로 분리해둔 구성입니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="min-h-[620px]">
                  <HomeDashboard basDd={latestDate} dateLoading={dateLoading} />
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {selectedView === "screening" ? (
          <Card className="border-slate-200 bg-white/95 shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-50/80">
              <CardTitle className="text-xl">스크리닝 성과 보드</CardTitle>
              <CardDescription>
                적재된 run과 가격 경로 기반 성과를 확인하는 메인 화면입니다.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <ScreeningMonitor />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function OverviewCard({
  title,
  description,
  actionLabel,
  onClick,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
}) {
  return (
    <Card className="border-slate-200 bg-white/95 shadow-sm">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription className="leading-6">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" onClick={onClick}>
          {actionLabel}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
