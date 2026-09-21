"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Button,
  TextField,
  MenuItem,
  Chip,
  Drawer,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Skeleton,
  Snackbar,
  IconButton,
  Pagination,
  LinearProgress,
} from "@mui/material";
import {
  Add,
  ArrowForward,
  CheckCircleOutlined,
  Close,
  DashboardOutlined,
  DescriptionOutlined,
  Logout,
  Menu,
  Refresh,
  Search,
  UploadFileOutlined,
  WorkOutlined,
  NorthEast,
} from "@mui/icons-material";
import {
  availableActions,
  label,
  statuses,
  type Actor,
  type OrderStatus,
} from "@/domain/rules";
import { orderInput } from "@/domain/validation";
import { request } from "./client-api";
import Upload from "./upload";
type Order = {
  id: string;
  title: string;
  customerBusiness: string;
  customerContactName: string;
  customerContactEmail: string;
  signageDescription: string;
  quantity: number;
  installationAddress: string;
  requestedInstallationDate: string;
  price: number;
  notes: string;
  vendorId: string;
  status: OrderStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
type Detail = Order & {
  assets: {
    id: string;
    originalFilename: string;
    status: string;
    declaredSize: number;
    mode: string;
  }[];
  history: {
    id: string;
    eventType: string;
    timestamp: string;
    actorRole: string;
  }[];
  vendor: { name: string } | null;
  job: { status: string } | null;
};
type Job = {
  id: string;
  orderId: string;
  status: string;
  revision: number;
  mine: boolean;
  expiresAt: string | null;
  claimId: string | null;
  identityVerificationStatus: string;
  paymentVerificationStatus: string;
  order: Pick<
    Order,
    | "title"
    | "customerBusiness"
    | "installationAddress"
    | "requestedInstallationDate"
    | "price"
    | "quantity"
  >;
};
type List = {
  items: Order[];
  total: number;
  page: number;
  counts: Record<string, number>;
  activeUploads: number;
};
const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n / 100);
const date = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
const statusColor: Record<string, string> = {
  DRAFT: "#87949c",
  SUBMITTED: "#d09a37",
  VENDOR_ACCEPTED: "#6e7dc9",
  IN_PRODUCTION: "#3283b5",
  READY_FOR_INSTALL: "#bf763a",
  COMPLETED: "#37866c",
  CANCELLED: "#b56666",
  AVAILABLE: "#3283b5",
  RESERVED: "#d09a37",
  ASSIGNED: "#6e7dc9",
};
function Status({ value }: { value: string }) {
  return (
    <Chip
      size="small"
      label={label(value)}
      sx={{
        fontSize: 11,
        fontWeight: 600,
        color: statusColor[value] ?? "#68777f",
        backgroundColor: `${statusColor[value] ?? "#68777f"}15`,
        border: "1px solid",
        borderColor: `${statusColor[value] ?? "#68777f"}22`,
      }}
    />
  );
}
function Timer({
  deadline,
  offset,
  onExpire,
}: {
  deadline: string;
  offset: number;
  onExpire: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(deadline) - now - offset) / 1000),
  );
  useEffect(() => {
    if (!seconds) onExpire();
  }, [seconds, onExpire]);
  return (
    <span className="countdown">
      {String(Math.floor(seconds / 60)).padStart(2, "0")}:
      {String(seconds % 60).padStart(2, "0")} remaining
    </span>
  );
}
export default function Dashboard({
  user,
  demo,
}: {
  user: Actor;
  demo: boolean;
}) {
  const installer = user.role === "INSTALLER";
  const manager = user.role === "MANAGER";
  const client = useQueryClient();
  const [view, setView] = useState(installer ? "Installations" : "Overview");
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Order | null | undefined>(undefined);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState("Connecting");
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    run: () => Promise<unknown>;
  } | null>(null);
  const orders = useQuery({
    queryKey: ["orders", search, filter, page],
    queryFn: () =>
      request<List>(
        `orders?search=${encodeURIComponent(search)}&status=${filter}&page=${page}`,
      ),
    enabled: !installer,
  });
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: async () => {
      const data = await request<{ items: Job[]; serverNow: string }>(
        "install-jobs",
      );
      return { ...data, offset: Date.parse(data.serverNow) - Date.now() };
    },
    enabled: installer || manager,
  });
  const detail = useQuery({
    queryKey: ["order", selected],
    queryFn: () => request<Detail>(`orders/${selected}`),
    enabled: !!selected,
  });
  const vendors = useQuery({
    queryKey: ["vendors"],
    queryFn: () => request<{ id: string; name: string }[]>("vendors"),
    enabled: manager,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["orders"] });
    void client.invalidateQueries({ queryKey: ["jobs"] });
    void client.invalidateQueries({ queryKey: ["order"] });
  };
  useEffect(() => {
    let stream: EventSource;
    let retry: ReturnType<typeof setTimeout>;
    let stopped = false;
    let delay = 1500;
    const connect = () => {
      if (stopped) return;
      stream = new EventSource("/api/events");
      stream.addEventListener("ready", () => {
        setLive("Live updates");
        delay = 1500;
        void client.invalidateQueries();
      });
      stream.addEventListener(
        "invalidate",
        () => void client.invalidateQueries(),
      );
      stream.addEventListener("unavailable", () => {
        setLive("Live updates paused");
        stream.close();
        retry = setTimeout(connect, Math.min((delay *= 2), 30000));
      });
      stream.onerror = () => {
        setLive("Reconnecting");
        stream.close();
        retry = setTimeout(connect, Math.min((delay *= 2), 30000));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      stream?.close();
    };
  }, [client]);
  async function perform(
    fn: () => Promise<unknown>,
    message = "Changes saved.",
  ) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setToast(message);
      setConfirm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
      refresh();
    }
  }
  const counts = orders.data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const active = total - (counts.COMPLETED ?? 0) - (counts.CANCELLED ?? 0);
  const nav = installer
    ? [{ name: "Installations", icon: <WorkOutlined /> }]
    : [
        { name: "Overview", icon: <DashboardOutlined /> },
        { name: "Orders", icon: <DescriptionOutlined /> },
        ...(manager ? [{ name: "Installations", icon: <WorkOutlined /> }] : []),
        { name: "Assets", icon: <UploadFileOutlined /> },
      ];
  const sidebar = (
    <>
      <Link className="brand" href="/">
        <span className="brand-mark">S</span>SignCraft
        <span className="brand-dot">®</span>
      </Link>
      <div className="workspace-switch">
        <span className="workspace-icon">SC</span>
        <div>
          <strong>Operations workspace</strong>
          <small>SignCraft / {label(user.role)}</small>
        </div>
      </div>
      <span className="nav-label">WORKSPACE</span>
      <nav>
        {nav.map((n) => (
          <button
            key={n.name}
            className={view === n.name ? "nav-active" : ""}
            onClick={() => {
              setView(n.name);
              setMobile(false);
            }}
          >
            {n.icon}
            <span>{n.name}</span>
            {n.name === "Orders" && <span className="nav-count">{total}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="team-note">
          <span className="team-graphic">↗</span>
          <strong>Good work, in motion.</strong>
          <p>
            One shared view.
            <br />
            Every step accounted for.
          </p>
        </div>
        <div className="user-row">
          <span className="avatar">
            {user.name
              ?.split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)}
          </span>
          <div>
            <strong>{user.name}</strong>
            <small>{label(user.role)}</small>
          </div>
          <IconButton
            aria-label="Sign out"
            size="small"
            onClick={() => void signOut({ callbackUrl: "/login" })}
          >
            <Logout fontSize="small" />
          </IconButton>
        </div>
      </div>
    </>
  );
  const showJobs = view === "Installations";
  return (
    <div className="app-shell">
      <aside className="sidebar">{sidebar}</aside>
      <Drawer open={mobile} onClose={() => setMobile(false)}>
        <div className="sidebar mobile-sidebar">{sidebar}</div>
      </Drawer>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu />
            </IconButton>
            <span>Workspace</span>
            <span>/</span>
            <strong>{view}</strong>
          </div>
          <div className="topbar-right">
            <span
              className={`live-status ${live === "Live updates" ? "connected" : ""}`}
            >
              <i />
              {live}
            </span>
            <IconButton aria-label="Refresh data" onClick={refresh}>
              <Refresh fontSize="small" />
            </IconButton>
            <span className="avatar small">{user.name?.[0]}</span>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <span className="eyebrow">SIGNCRAFT OPERATIONS</span>
              <h1>
                {showJobs
                  ? "Installation board"
                  : view === "Assets"
                    ? "Production assets"
                    : view === "Orders"
                      ? "Every order. One place."
                      : "Your operations, at a glance."}
              </h1>
              <p className="muted">
                {showJobs
                  ? "Find your next job. Take it from ready to installed."
                  : view === "Assets"
                    ? "Open an order to manage its production-ready files."
                    : "Keep every job moving, from the first brief to the final install."}
              </p>
            </div>
            {manager && !showJobs && (
              <Button
                variant="contained"
                startIcon={<Add />}
                onClick={() => setEditing(null)}
              >
                Create order
              </Button>
            )}
          </div>
          {error && (
            <Alert severity="error" onClose={() => setError("")} sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {(orders.error || jobs.error) && (
            <Alert
              severity="error"
              action={<Button onClick={refresh}>Retry</Button>}
            >
              {(orders.error ?? jobs.error)?.message}
            </Alert>
          )}
          {!showJobs && (
            <>
              <section className="metrics">
                {[
                  {
                    name: manager ? "Active orders" : "Assigned orders",
                    value: active,
                    caption: "Across your workflow",
                    icon: <DescriptionOutlined />,
                    color: "green",
                  },
                  {
                    name: "In production",
                    value: counts.IN_PRODUCTION ?? 0,
                    caption: "Being brought to life",
                    icon: <WorkOutlined />,
                    color: "blue",
                  },
                  {
                    name: "Ready to install",
                    value: counts.READY_FOR_INSTALL ?? 0,
                    caption: "The final stretch",
                    icon: <NorthEast />,
                    color: "orange",
                  },
                  {
                    name: manager ? "Active uploads" : "Completed orders",
                    value: manager
                      ? (orders.data?.activeUploads ?? 0)
                      : (counts.COMPLETED ?? 0),
                    caption: manager
                      ? "Files on their way"
                      : "Signed, sealed, installed",
                    icon: <UploadFileOutlined />,
                    color: "purple",
                  },
                ].map((m) => (
                  <article className="metric" key={m.name}>
                    <div className="metric-top">
                      <span>{m.name}</span>
                      <span className={`metric-icon ${m.color}`}>{m.icon}</span>
                    </div>
                    <strong>
                      {orders.isLoading
                        ? "—"
                        : m.value.toString().padStart(2, "0")}
                    </strong>
                    <small>{m.caption}</small>
                  </article>
                ))}
              </section>
              {view === "Overview" && (
                <section className="overview-grid">
                  <article className="panel pipeline">
                    <div className="panel-heading">
                      <div>
                        <h2>Order pipeline</h2>
                        <p className="muted">A clear view of every stage</p>
                      </div>
                      <span className="subtle-pill">{total} total orders</span>
                    </div>
                    <div className="pipeline-track">
                      {statuses
                        .filter((s) => s !== "CANCELLED")
                        .map((s) => (
                          <button
                            key={s}
                            onClick={() => {
                              setFilter(s);
                              setPage(1);
                              setView("Orders");
                            }}
                          >
                            <div className="pipeline-stage">
                              <span style={{ background: statusColor[s] }} />
                              <small>{label(s)}</small>
                            </div>
                            <strong>{counts[s] ?? 0}</strong>
                            <div className="pipeline-bar">
                              <div
                                style={{
                                  width: `${Math.max(8, ((counts[s] ?? 0) / Math.max(1, total)) * 100)}%`,
                                  background: statusColor[s],
                                }}
                              />
                            </div>
                          </button>
                        ))}
                    </div>
                  </article>
                  <article className="focus-card">
                    <span className="eyebrow">UP NEXT</span>
                    <h2>
                      {counts.READY_FOR_INSTALL
                        ? "Ready for the real world."
                        : "Keep the work flowing."}
                    </h2>
                    <p>
                      {counts.READY_FOR_INSTALL
                        ? `${counts.READY_FOR_INSTALL} orders are ready for installation. Let’s get them over the finish line.`
                        : "Check your active orders and give the next stage a clear path forward."}
                    </p>
                    <button
                      onClick={() => {
                        setView(manager ? "Installations" : "Orders");
                      }}
                    >
                      View {manager ? "installations" : "orders"}{" "}
                      <ArrowForward fontSize="small" />
                    </button>
                    <span className="focus-art">↗</span>
                  </article>
                </section>
              )}
              <section className="panel orders-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      {view === "Overview"
                        ? "Recent orders"
                        : view === "Assets"
                          ? "Orders & assets"
                          : "All orders"}{" "}
                      <span className="count-badge">
                        {orders.data?.total ?? 0}
                      </span>
                    </h2>
                    <p className="muted">
                      {view === "Assets"
                        ? "Select an order to inspect files, upload assets, or download completed artwork."
                        : "The latest on what’s in progress."}
                    </p>
                  </div>
                  {view === "Overview" && (
                    <Button
                      onClick={() => setView("Orders")}
                      endIcon={<ArrowForward />}
                    >
                      View all orders
                    </Button>
                  )}
                </div>
                <div className="table-toolbar">
                  <TextField
                    placeholder="Search orders or businesses…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    slotProps={{
                      input: {
                        startAdornment: (
                          <Search
                            fontSize="small"
                            sx={{ mr: 1, color: "#87949c" }}
                          />
                        ),
                      },
                    }}
                  />
                  <TextField
                    select
                    label="Status"
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setPage(1);
                    }}
                    sx={{ minWidth: 180 }}
                  >
                    <MenuItem value="">All statuses</MenuItem>
                    {statuses.map((s) => (
                      <MenuItem key={s} value={s}>
                        {label(s)}
                      </MenuItem>
                    ))}
                  </TextField>
                </div>
                {orders.isLoading ? (
                  <div className="loading-list">
                    {[1, 2, 3, 4].map((x) => (
                      <Skeleton key={x} height={64} />
                    ))}
                  </div>
                ) : orders.data?.items.length ? (
                  <>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>ORDER / BUSINESS</th>
                            <th>STATUS</th>
                            <th>INSTALLATION</th>
                            <th>VALUE</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {orders.data.items.map((o) => (
                            <tr key={o.id} onClick={() => setSelected(o.id)}>
                              <td>
                                <div className="order-name">
                                  <span className="order-icon">
                                    <DescriptionOutlined fontSize="small" />
                                  </span>
                                  <div>
                                    <button
                                      className="text-button"
                                      onClick={() => setSelected(o.id)}
                                    >
                                      {o.title}
                                    </button>
                                    <small>
                                      {o.customerBusiness}{" "}
                                      <span className="order-id">
                                        · {o.id.slice(-6).toUpperCase()}
                                      </span>
                                    </small>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <Status value={o.status} />
                              </td>
                              <td>
                                <span>{date(o.requestedInstallationDate)}</span>
                                <small className="muted">
                                  {o.installationAddress.split(",")[0]}
                                </small>
                              </td>
                              <td>
                                <strong className="table-price">
                                  {money(o.price)}
                                </strong>
                              </td>
                              <td>
                                <ArrowForward
                                  fontSize="small"
                                  sx={{ color: "#87949c" }}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="order-cards">
                      {orders.data.items.map((o) => (
                        <button key={o.id} onClick={() => setSelected(o.id)}>
                          <div>
                            <strong>{o.title}</strong>
                            <Status value={o.status} />
                          </div>
                          <p>{o.customerBusiness}</p>
                          <small>
                            {date(o.requestedInstallationDate)} ·{" "}
                            {money(o.price)}
                          </small>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <DescriptionOutlined />
                    <h3>No orders found</h3>
                    <p>
                      Try another search or status.
                      {manager ? " You can also create your first order." : ""}
                    </p>
                  </div>
                )}
                <div className="table-footer">
                  <span>
                    Showing {orders.data?.items.length ?? 0} of{" "}
                    {orders.data?.total ?? 0} orders
                  </span>
                  <Pagination
                    count={Math.max(
                      1,
                      Math.ceil((orders.data?.total ?? 0) / 10),
                    )}
                    page={page}
                    onChange={(_, p) => setPage(p)}
                    size="small"
                  />
                </div>
              </section>
            </>
          )}
          {showJobs && (
            <>
              <div className="board-summary">
                <span>
                  <i />
                  {jobs.data?.items.filter((j) => j.status === "AVAILABLE")
                    .length ?? 0}{" "}
                  available jobs
                </span>
                <span>
                  Reservations last 3 minutes · Verification is simulated
                </span>
              </div>
              {jobs.isLoading ? (
                <Skeleton height={280} />
              ) : (
                <section className="job-grid">
                  {jobs.data?.items.map((job) => (
                    <article className="job-card" key={job.id}>
                      <div className="job-card-top">
                        <span className="order-icon">
                          <WorkOutlined />
                        </span>
                        <Status value={job.status} />
                      </div>
                      <small className="eyebrow">
                        {job.order.customerBusiness}
                      </small>
                      <h2>{job.order.title}</h2>
                      <p className="muted">{job.order.installationAddress}</p>
                      <div className="job-meta">
                        <span>
                          Installation date
                          <strong>
                            {date(job.order.requestedInstallationDate)}
                          </strong>
                        </span>
                        <span>
                          Job value<strong>{money(job.order.price)}</strong>
                        </span>
                      </div>
                      {job.mine && job.expiresAt && (
                        <Timer
                          deadline={job.expiresAt}
                          offset={jobs.data?.offset ?? 0}
                          onExpire={() =>
                            void client.invalidateQueries({
                              queryKey: ["jobs"],
                            })
                          }
                        />
                      )}
                      {job.mine && job.status === "RESERVED" && (
                        <div className="verification">
                          <p>
                            Identity{" "}
                            <strong>
                              {label(job.identityVerificationStatus)}
                            </strong>
                          </p>
                          <p>
                            Payment{" "}
                            <strong>
                              {label(job.paymentVerificationStatus)}
                            </strong>
                          </p>
                          <Button
                            fullWidth
                            disabled={busy}
                            variant="contained"
                            onClick={() => {
                              const kind =
                                job.identityVerificationStatus === "PASSED"
                                  ? "payment"
                                  : "identity";
                              setConfirm({
                                title: `Simulate ${kind} verification`,
                                description:
                                  "This demo verifies your reservation ownership and server deadline. No identity documents or payment details are collected.",
                                run: () =>
                                  request(
                                    `install-jobs/${job.id}/verify/${kind}`,
                                    {
                                      claimId: job.claimId,
                                      revision: job.revision,
                                    },
                                  ),
                              });
                            }}
                          >
                            Verify{" "}
                            {job.identityVerificationStatus === "PASSED"
                              ? "payment"
                              : "identity"}
                          </Button>
                          {demo && (
                            <Button
                              fullWidth
                              size="small"
                              color="error"
                              disabled={busy}
                              onClick={() =>
                                void perform(
                                  () =>
                                    request(
                                      `install-jobs/${job.id}/verify/${job.identityVerificationStatus === "PASSED" ? "payment" : "identity"}`,
                                      {
                                        claimId: job.claimId,
                                        revision: job.revision,
                                        fail: true,
                                      },
                                    ),
                                  "Demo verification failed. Reservation released.",
                                )
                              }
                            >
                              Simulate verification failure
                            </Button>
                          )}
                        </div>
                      )}
                      {installer && job.status === "AVAILABLE" && (
                        <Button
                          fullWidth
                          variant="outlined"
                          disabled={busy}
                          endIcon={<ArrowForward />}
                          onClick={() =>
                            setConfirm({
                              title: "Reserve this installation?",
                              description:
                                "You’ll have 3 minutes to complete simulated identity and payment verification. The job returns to the board if the reservation expires.",
                              run: () =>
                                request(`install-jobs/${job.id}/claim`, {}),
                            })
                          }
                        >
                          Claim installation
                        </Button>
                      )}
                      {job.mine && job.status === "ASSIGNED" && (
                        <Button
                          fullWidth
                          variant="contained"
                          disabled={busy}
                          startIcon={<CheckCircleOutlined />}
                          onClick={() =>
                            setConfirm({
                              title: "Complete installation?",
                              description:
                                "This confirms the work is installed and closes both the installation job and its order.",
                              run: () =>
                                request(`install-jobs/${job.id}/complete`, {
                                  revision: job.revision,
                                }),
                            })
                          }
                        >
                          Complete installation
                        </Button>
                      )}
                      {manager && (
                        <Button
                          fullWidth
                          onClick={() => setSelected(job.orderId)}
                        >
                          View order
                        </Button>
                      )}
                    </article>
                  ))}
                </section>
              )}
              {!jobs.isLoading && !jobs.data?.items.length && (
                <div className="empty-state">
                  <WorkOutlined />
                  <h3>You’re all caught up.</h3>
                  <p>
                    Installation jobs appear here when production is complete.
                  </p>
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>SIGNCRAFT OPERATIONS</span>
            <span>Every detail. Every step. Together.</span>
          </footer>
        </main>
      </div>
      <Drawer
        anchor="right"
        open={!!selected}
        onClose={() => setSelected(null)}
        slotProps={{ paper: { sx: { width: { xs: "100%", sm: 570 } } } }}
      >
        <div className="detail-drawer">
          <div className="drawer-heading">
            <span className="eyebrow">ORDER DETAILS</span>
            <IconButton
              aria-label="Close order details"
              onClick={() => setSelected(null)}
            >
              <Close />
            </IconButton>
          </div>
          {detail.isLoading ? (
            <Skeleton height={400} />
          ) : detail.error ? (
            <Alert severity="error">{detail.error.message}</Alert>
          ) : (
            detail.data && (
              <>
                <Status value={detail.data.status} />
                <h1>{detail.data.title}</h1>
                <p className="muted">
                  {detail.data.customerBusiness} · #
                  {detail.data.id.slice(-6).toUpperCase()}
                </p>
                <div className="button-row">
                  {manager && detail.data.status === "DRAFT" && (
                    <Button
                      variant="outlined"
                      onClick={() => setEditing(detail.data!)}
                    >
                      Edit draft
                    </Button>
                  )}
                  {availableActions(detail.data.status, user.role).map((s) => (
                    <Button
                      key={s}
                      color={s === "CANCELLED" ? "error" : "primary"}
                      variant={s === "CANCELLED" ? "outlined" : "contained"}
                      disabled={busy}
                      onClick={() => {
                        const order = detail.data!;
                        setConfirm({
                          title: `${label(s)}?`,
                          description: `Update “${order.title}” to ${label(s).toLowerCase()}. This action is recorded in its history.`,
                          run: () =>
                            request(`orders/${order.id}/transition`, {
                              status: s,
                              revision: order.revision,
                            }),
                        });
                      }}
                    >
                      {s === "SUBMITTED"
                        ? "Submit order"
                        : s === "VENDOR_ACCEPTED"
                          ? "Accept order"
                          : s === "IN_PRODUCTION"
                            ? "Start production"
                            : s === "READY_FOR_INSTALL"
                              ? "Mark ready"
                              : label(s)}
                    </Button>
                  ))}
                </div>
                <section className="detail-section">
                  <h2>The brief</h2>
                  <p>{detail.data.signageDescription}</p>
                  <dl>
                    <dt>Quantity</dt>
                    <dd>{detail.data.quantity}</dd>
                    <dt>Vendor</dt>
                    <dd>{detail.data.vendor?.name}</dd>
                    <dt>Installation</dt>
                    <dd>{date(detail.data.requestedInstallationDate)}</dd>
                    <dt>Location</dt>
                    <dd>{detail.data.installationAddress}</dd>
                    <dt>Order value</dt>
                    <dd>{money(detail.data.price)}</dd>
                    <dt>Contact</dt>
                    <dd>
                      {detail.data.customerContactName}
                      <br />
                      {detail.data.customerContactEmail}
                    </dd>
                  </dl>
                  {detail.data.notes && (
                    <p className="detail-note">{detail.data.notes}</p>
                  )}
                  {detail.data.job && (
                    <p>
                      Installation: <Status value={detail.data.job.status} />
                    </p>
                  )}
                </section>
                <section className="detail-section">
                  <h2>
                    Production assets{" "}
                    <span className="count-badge">
                      {detail.data.assets.length}
                    </span>
                  </h2>
                  {detail.data.assets.map((asset) => (
                    <div className="asset-item" key={asset.id}>
                      <UploadFileOutlined />
                      <div>
                        <strong>{asset.originalFilename}</strong>
                        <small>
                          {(asset.declaredSize / 1024 ** 2).toFixed(1)} MiB ·{" "}
                          {asset.mode === "simulation"
                            ? "Simulated"
                            : "R2 storage"}{" "}
                          · {label(asset.status)}
                        </small>
                      </div>
                      {asset.status === "COMPLETED" && (
                        <Button
                          size="small"
                          onClick={() =>
                            void perform(
                              async () => {
                                const result = await request<{
                                  url?: string;
                                  message?: string;
                                }>("uploads/download", { assetId: asset.id });
                                if (result.url)
                                  window.open(
                                    result.url,
                                    "_blank",
                                    "noopener,noreferrer",
                                  );
                                else
                                  setToast(
                                    result.message ?? "Simulation only.",
                                  );
                              },
                              asset.mode === "simulation"
                                ? "Simulation complete. No file bytes were stored."
                                : "Download ready.",
                            )
                          }
                        >
                          View
                        </Button>
                      )}
                    </div>
                  ))}
                  {!detail.data.assets.length && (
                    <p className="muted">
                      No assets yet. A completed asset is required to start
                      production.
                    </p>
                  )}
                  {manager &&
                    !["CANCELLED", "COMPLETED"].includes(
                      detail.data.status,
                    ) && <Upload orderId={detail.data.id} onDone={refresh} />}
                </section>
                <section className="detail-section">
                  <h2>Activity history</h2>
                  <div className="timeline">
                    {detail.data.history.map((e) => (
                      <div key={e.id}>
                        <i />
                        <strong>{label(e.eventType)}</strong>
                        <small>
                          {label(e.actorRole)} ·{" "}
                          {new Date(e.timestamp).toLocaleString()}
                        </small>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )
          )}
        </div>
      </Drawer>
      <Dialog
        open={!!confirm}
        onClose={() => !busy && setConfirm(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{confirm?.title}</DialogTitle>
        <DialogContent>
          <p className="muted">{confirm?.description}</p>
          {error && <Alert severity="error">{error}</Alert>}
          {busy && <LinearProgress />}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirm(null)}>
            Go back
          </Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => confirm && void perform(confirm.run)}
          >
            {busy ? "Working…" : "Confirm"}
          </Button>
        </DialogActions>
      </Dialog>
      {editing !== undefined && (
        <OrderForm
          order={editing}
          vendors={vendors.data ?? []}
          onClose={() => setEditing(undefined)}
          onSave={async (data) => {
            await request(
              `orders${editing ? `/${editing.id}` : ""}`,
              { ...data, ...(editing ? { revision: editing.revision } : {}) },
              editing ? "PATCH" : "POST",
            );
            setEditing(undefined);
            setToast(editing ? "Order updated." : "Order created.");
            refresh();
          }}
        />
      )}
      <Snackbar
        open={!!toast}
        autoHideDuration={5500}
        onClose={() => setToast("")}
        message={toast}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </div>
  );
}
function OrderForm({
  order,
  vendors,
  onClose,
  onSave,
}: {
  order: Order | null;
  vendors: { id: string; name: string }[];
  onClose: () => void;
  onSave: (data: z.output<typeof orderInput>) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const form = useForm<
    z.input<typeof orderInput>,
    unknown,
    z.output<typeof orderInput>
  >({
    resolver: zodResolver(orderInput),
    defaultValues: order ?? {
      title: "",
      customerBusiness: "",
      customerContactName: "",
      customerContactEmail: "",
      signageDescription: "",
      quantity: 1,
      installationAddress: "",
      requestedInstallationDate: new Date().toISOString().slice(0, 10),
      price: 0,
      notes: "",
      vendorId: vendors[0]?.id ?? "",
    },
  });
  const fields: {
    key: keyof z.input<typeof orderInput>;
    label: string;
    type?: string;
    wide?: boolean;
  }[] = [
    { key: "title", label: "Order title", wide: true },
    { key: "customerBusiness", label: "Business name" },
    { key: "vendorId", label: "Production vendor" },
    { key: "customerContactName", label: "Contact name" },
    { key: "customerContactEmail", label: "Contact email", type: "email" },
    { key: "signageDescription", label: "Signage description", wide: true },
    { key: "quantity", label: "Quantity", type: "number" },
    { key: "price", label: "Job value (USD cents)", type: "number" },
    { key: "installationAddress", label: "Installation address", wide: true },
    {
      key: "requestedInstallationDate",
      label: "Installation date",
      type: "date",
    },
    { key: "notes", label: "Internal notes", wide: true },
  ];
  return (
    <Dialog
      open
      onClose={() => !form.formState.isSubmitting && onClose()}
      fullWidth
      maxWidth="sm"
    >
      <form
        onSubmit={form.handleSubmit(async (data) => {
          try {
            await onSave(data);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to save order.");
          }
        })}
      >
        <DialogTitle>
          {order ? "Edit draft" : "Create an order"}
          <p className="dialog-subtitle">
            Start with the details. Bring it to life, together.
          </p>
        </DialogTitle>
        <DialogContent>
          <div className="form-grid">
            {fields.map((f) => (
              <TextField
                key={f.key}
                label={f.label}
                type={f.type ?? "text"}
                select={f.key === "vendorId"}
                multiline={["notes", "signageDescription"].includes(f.key)}
                minRows={f.key === "signageDescription" ? 2 : undefined}
                className={f.wide ? "full-width" : ""}
                slotProps={{ inputLabel: { shrink: true } }}
                {...form.register(
                  f.key,
                  f.type === "number" ? { valueAsNumber: true } : {},
                )}
                defaultValue={
                  f.key === "vendorId"
                    ? (order?.vendorId ?? vendors[0]?.id ?? "")
                    : undefined
                }
                error={!!form.formState.errors[f.key]}
                helperText={form.formState.errors[f.key]?.message}
              >
                {f.key === "vendorId"
                  ? vendors.map((v) => (
                      <MenuItem value={v.id} key={v.id}>
                        {v.name}
                      </MenuItem>
                    ))
                  : undefined}
              </TextField>
            ))}
          </div>
          {error && <Alert severity="error">{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={form.formState.isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting
              ? "Saving…"
              : order
                ? "Save changes"
                : "Create draft"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
