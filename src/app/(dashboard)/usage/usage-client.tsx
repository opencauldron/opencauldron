"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Wand2, DollarSign, TrendingUp, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface UsageData {
  dailyLimit: number;
  today: { count: number; cost: number };
  week: { count: number; cost: number };
  month: { count: number; cost: number };
  byModel: { model: string; count: number; cost: number }[];
  recent: {
    id: string;
    model: string;
    prompt: string;
    status: string;
    costEstimate: number;
    durationMs: number | null;
    createdAt: string;
  }[];
}

export function UsageClient() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/usage")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Wand2 className="h-3 w-3" /> Today
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.today.count}</div>
            <p className="text-xs text-muted-foreground">
              of {data.dailyLimit} limit
            </p>
            <div className="mt-2 h-1.5 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${Math.min(100, (data.today.count / data.dailyLimit) * 100)}%`,
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> Today Cost
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${data.today.cost.toFixed(2)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> This Week
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.week.count}</div>
            <p className="text-xs text-muted-foreground">
              ${data.week.cost.toFixed(2)} spent
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> This Month
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.month.count}</div>
            <p className="text-xs text-muted-foreground">
              ${data.month.cost.toFixed(2)} spent
            </p>
          </CardContent>
        </Card>
      </div>

      {/* By Model */}
      {data.byModel.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Usage by Model (30 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.byModel.map((m) => (
                <div
                  key={m.model}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{m.model}</Badge>
                    <span className="text-sm">{m.count} generations</span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    ${m.cost.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Generations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Recent Generations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No generations yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Prompt</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((gen) => (
                  <TableRow key={gen.id}>
                    <TableCell className="max-w-[300px] truncate text-sm">
                      {gen.prompt}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {gen.model}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          gen.status === "completed" ? "default" : "secondary"
                        }
                        className="text-xs"
                      >
                        {gen.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {gen.durationMs
                        ? `${(gen.durationMs / 1000).toFixed(1)}s`
                        : "-"}
                    </TableCell>
                    <TableCell className="text-xs">
                      ${gen.costEstimate.toFixed(3)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(gen.createdAt), {
                        addSuffix: true,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
