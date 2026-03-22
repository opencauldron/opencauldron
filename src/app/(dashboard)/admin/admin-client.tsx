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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DollarSign, TrendingUp, Users, Pencil } from "lucide-react";
import { toast } from "sonner";

interface TeamUsage {
  today: { count: number; cost: number };
  month: { count: number; cost: number };
  byModel: { model: string; count: number; cost: number }[];
  byUser: {
    userId: string;
    userName: string | null;
    userEmail: string;
    count: number;
    cost: number;
  }[];
}

interface UserData {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  dailyLimit: number;
  createdAt: string;
  monthlyGenerations: number;
  monthlyCost: number;
}

export function AdminClient() {
  const [usage, setUsage] = useState<TeamUsage | null>(null);
  const [teamUsers, setTeamUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/usage").then((r) => r.json()),
      fetch("/api/admin/users").then((r) => r.json()),
    ])
      .then(([usageData, userData]) => {
        if (usageData.error) {
          setError(usageData.error);
          return;
        }
        setUsage(usageData);
        setTeamUsers(userData.users ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!usage) return null;

  return (
    <div className="space-y-6">
      {/* Team Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" /> Today (Team)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{usage.today.count}</div>
            <p className="text-xs text-muted-foreground">
              ${usage.today.cost.toFixed(2)} spent
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> This Month (Team)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{usage.month.count}</div>
            <p className="text-xs text-muted-foreground">
              ${usage.month.cost.toFixed(2)} spent
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Users className="h-3 w-3" /> Team Members
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teamUsers.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* By Model */}
      {usage.byModel.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              Usage by Model (30 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {usage.byModel.map((m) => (
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

      {/* Team Members */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Team Members</CardTitle>
          <CardDescription>Manage roles and daily limits</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Daily Limit</TableHead>
                <TableHead>Monthly Gens</TableHead>
                <TableHead>Monthly Cost</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teamUsers.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarImage src={u.image ?? undefined} />
                        <AvatarFallback className="text-xs">
                          {u.name?.[0]?.toUpperCase() ?? "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {u.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={u.role === "admin" ? "default" : "secondary"}
                      className="text-xs"
                    >
                      {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{u.dailyLimit}</TableCell>
                  <TableCell className="text-sm">
                    {u.monthlyGenerations}
                  </TableCell>
                  <TableCell className="text-sm">
                    ${u.monthlyCost.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <EditUserDialog user={u} onSave={handleUserUpdate} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );

  async function handleUserUpdate(
    userId: string,
    updates: { role?: string; dailyLimit?: number }
  ) {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }

      setTeamUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, ...updates } : u))
      );
      toast.success("User updated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update user"
      );
    }
  }
}

function EditUserDialog({
  user,
  onSave,
}: {
  user: UserData;
  onSave: (id: string, updates: { role?: string; dailyLimit?: number }) => void;
}) {
  const [role, setRole] = useState(user.role);
  const [limit, setLimit] = useState(user.dailyLimit.toString());

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm">
            <Pencil className="h-3 w-3" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {user.name ?? user.email}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium">Role</label>
            <div className="mt-1 flex gap-2">
              <button
                onClick={() => setRole("member")}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  role === "member"
                    ? "border-primary bg-primary/10"
                    : "border-border"
                }`}
              >
                Member
              </button>
              <button
                onClick={() => setRole("admin")}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  role === "admin"
                    ? "border-primary bg-primary/10"
                    : "border-border"
                }`}
              >
                Admin
              </button>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Daily Limit</label>
            <Input
              type="number"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              min={1}
              max={10000}
              className="mt-1"
            />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose
              render={<Button variant="outline">Cancel</Button>}
            />
            <Button
              onClick={() => {
                onSave(user.id, {
                  role,
                  dailyLimit: parseInt(limit, 10),
                });
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
