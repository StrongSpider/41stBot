import { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Loader2, ShieldCheck, XCircle, AlertTriangle, Users, Calendar, DollarSign, Package, AlertCircle } from "lucide-react";

// --- Main Page Component ---
// --- Main Page Component ---
export default function OfficerLabeling() {
    const { user } = useAuth(); // Get logged in user
    const [candidate, setCandidate] = useState(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    // Dynamic Examples State
    const [examples, setExamples] = useState({ real: null, alt: null });

    // Constants
    const REAL_EXAMPLE_ID = 346320305;
    const ALT_EXAMPLE_ID = 8781802337;

    // Fetch Examples on Mount
    useEffect(() => {
        const fetchExamples = async () => {
            try {
                // Fetch both examples in parallel
                const [realRes, altRes] = await Promise.all([
                    fetch(`/api/candidates?forceId=${REAL_EXAMPLE_ID}`),
                    fetch(`/api/candidates?forceId=${ALT_EXAMPLE_ID}`)
                ]);

                const realData = await realRes.json();
                const altData = await altRes.json();

                setExamples({
                    real: realData.candidate ? { ...realData.candidate, username: "Real Example" } : null,
                    alt: altData.candidate ? { ...altData.candidate, username: "Alt Example" } : null
                });
            } catch (err) {
                console.error("Failed to load examples", err);
            }
        };
        fetchExamples();
    }, []);

    const fetchCandidate = async () => {
        setCandidate(null); // Clear previous candidate to show loading screen
        setLoading(true);
        setError(null);
        try {
            // Backend now handles auth via session
            const res = await fetch('/api/candidates');
            if (res.status === 401) throw new Error('Unauthorized - Please log in');
            if (!res.ok) throw new Error('Failed to fetch candidate');
            const data = await res.json();
            setCandidate(data.candidate);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCandidate();
    }, []);

    const handleVote = async (label) => {
        if (!candidate) return;
        setSubmitting(true);

        try {
            const res = await fetch('/api/labels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetRobloxId: candidate.robloxId,
                    officerDiscordId: user?.id, // Send from Auth Context
                    label: label
                })
            });

            const json = await res.json();
            if (!res.ok) {
                console.error("Vote failed:", json);
                throw new Error(json.error || 'Failed to submit vote');
            }
            fetchCandidate();
        } catch (err) {
            console.error(err);
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    if (loading && !candidate) return <LoadingState />;
    if (error) return <ErrorState error={error} retry={fetchCandidate} />;

    return (
        <div className="container mx-auto p-4 max-w-[1600px]">
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">

                {/* Left Column: Main Candidate View (Spans 3 cols) */}
                <div className="xl:col-span-3 space-y-6">
                    <Card className="border-2 border-primary/20 shadow-2xl bg-neutral-900/50">
                        <CardHeader className="border-b border-border/50 bg-neutral-900/80 sticky top-0 z-10 backdrop-blur-md">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                                <div>
                                    <div className="flex items-center gap-3">
                                        <CardTitle className="text-3xl font-bold">
                                            {candidate.username}
                                        </CardTitle>
                                        <Badge variant="outline" className="text-muted-foreground font-mono font-normal">
                                            {candidate.robloxId}
                                        </Badge>
                                    </div>
                                    <CardDescription className="text-lg mt-1">
                                        Candidate Analysis
                                    </CardDescription>
                                </div>
                                <div className="flex gap-2 w-full md:w-auto">
                                    <VoteButton label="REAL" color="bg-green-600 hover:bg-green-700" onClick={() => handleVote('REAL')} disabled={submitting} />
                                    <VoteButton label="LIKELY_REAL" color="bg-emerald-500/80" onClick={() => handleVote('LIKELY_REAL')} disabled={submitting} />
                                    <VoteButton label="LIKELY_ALT" color="bg-orange-500/80" onClick={() => handleVote('LIKELY_ALT')} disabled={submitting} />
                                    <VoteButton label="ALT" color="bg-red-600 hover:bg-red-700" onClick={() => handleVote('ALT')} disabled={submitting} />
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <ProfileDetailView data={candidate} />
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: References Sidebar (Spans 1 col) */}
                <div className="space-y-4 xl:sticky xl:top-4 h-fit">
                    <h3 className="font-bold text-xl px-2">References</h3>

                    {examples.real ? (
                        <ReferenceItem data={examples.real} label="REAL" color="bg-green-500/10 text-green-500 border-green-500/30" badgeVariant="default" badgeColor="bg-green-600" />
                    ) : (
                        <SkeletonReference />
                    )}

                    {examples.alt ? (
                        <ReferenceItem data={examples.alt} label="ALT" color="bg-red-500/10 text-red-500 border-red-500/30" badgeVariant="destructive" badgeColor="bg-red-600" />
                    ) : (
                        <SkeletonReference />
                    )}

                    <Card className="bg-muted/30">
                        <CardHeader>
                            <CardTitle className="text-sm">Indicators</CardTitle>
                        </CardHeader>
                        <CardContent className="text-xs space-y-2 text-muted-foreground">
                            <p>🚩 <strong>Base Rank:</strong> User is lowest rank (Guest/Member) in a group.</p>
                            <p>🚩 <strong>Suspicious Badge:</strong> User visited a known "free badge" or "botting" game.</p>
                            <p>🚩 <strong>Low Assets:</strong> Only default or free items.</p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}

// --- Reusable Detailed View ---
function ProfileDetailView({ data }) {
    if (!data) return null;
    // Extract connections explicitly
    const { profile, stats, groups, badges, badgeGraph, inventory, connections } = data;

    // Helper to format date
    const joinDate = profile?.created ? new Date(profile.created).toLocaleDateString(undefined, { dateStyle: 'long' }) : 'Unknown';

    // Inventory Splitting
    const devTypes = ['Plugin', 'Model', 'Decal', 'Audio', 'MeshPart'];
    const isDev = (item) => devTypes.includes(item.type);
    const invArr = Array.isArray(inventory) ? inventory : [];
    const regularAssets = invArr.filter(i => !isDev(i));
    const devAssets = invArr.filter(i => isDev(i));

    // Sort Groups: Non-Base Rank first (as requested)
    const sortedGroups = Array.isArray(groups) ? [...groups].sort((a, b) => {
        if (a.IsBaseRank === b.IsBaseRank) return 0;
        return a.IsBaseRank ? 1 : -1; // Non-base (false) comes before Base (true)
    }) : [];

    return (
        <div className="flex flex-col divide-y divide-border/50">
            {/* 1. Header Detail */}
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 bg-muted/10">
                <div className="flex flex-col gap-1 justify-center lg:col-span-1 p-2">
                    <div className="text-xl font-bold">{data.username}</div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="w-4 h-4" /> Joined: {joinDate}
                    </div>
                    <Badge variant="outline" className="w-fit mt-1">
                        {profile?.ageDays} Days Old
                    </Badge>
                </div>

                <StatCard icon={<Users />} label="Friends" value={connections?.friendCount} highlight />
                <StatCard icon={<Users />} label="Followers" value={connections?.followerCount} />
                <StatCard icon={<Users />} label="Following" value={connections?.followingCount} />
            </div>

            {/* 2. Logic / Risk Section */}
            <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* Groups */}
                <div>
                    <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                        <Users className="w-5 h-5 text-primary" /> Groups ({stats?.groupCount})
                    </h3>
                    <div className="grid grid-cols-1 gap-2 max-h-[400px] overflow-y-auto pr-2">
                        {sortedGroups.map((g, i) => (
                            <div key={i} className={`flex justify-between items-center p-3 rounded-md text-sm border transition-all ${g.IsBaseRank ? 'bg-red-500/10 border-red-500/30' : 'bg-background border-border hover:border-primary/30'}`}>
                                <span className="truncate font-medium max-w-[200px]" title={g.Name}>{g.Name}</span>
                                <div className="flex items-center gap-2">
                                    {g.IsBaseRank && <Badge variant="destructive" className="px-2 py-0.5 text-xs font-bold shadow-sm">Base Rank</Badge>}
                                    {!g.IsBaseRank && <Badge variant="destructive" className="px-2 py-0.5 text-xs font-bold shadow-sm">{g.Role}</Badge>}
                                </div>
                            </div>
                        ))}
                        {sortedGroups.length === 0 && <p className="text-sm text-muted-foreground p-4 text-center border rounded-md border-dashed">No groups found.</p>}
                    </div>
                </div>

                {/* Badges & Graph */}
                <div>
                    <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5 text-primary" /> Badges ({stats?.badgeCount})
                    </h3>

                    {/* Suspicious Badges List */}
                    {badges?.hasSuspicious && badges.suspicious.length > 0 && (
                        <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-4 shadow-sm">
                            <h4 className="text-sm font-bold text-red-500 flex items-center gap-2 mb-2">
                                <AlertCircle className="w-4 h-4" /> Suspicious Badge Activity Detected
                            </h4>
                            <ul className="space-y-1">
                                {badges.suspicious.map((s, i) => (
                                    <li key={i} className="text-xs text-red-400 font-mono">
                                        [{s.placeId}] {s.reason}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Graph Image */}
                    {badgeGraph?.base64 ? (
                        <Dialog>
                            <DialogTrigger asChild>
                                <div className="rounded-lg overflow-hidden border border-border/50 bg-black shadow-inner cursor-zoom-in hover:opacity-90 transition-opacity">
                                    <img src={badgeGraph.base64} alt="Badge Graph" className="w-full h-auto object-contain" />
                                </div>
                            </DialogTrigger>
                            <DialogContent className="max-w-[90vw] w-fit p-0 border-none bg-transparent shadow-none">
                                <div className="relative">
                                    <img src={badgeGraph.base64} alt="Badge Graph Full" className="max-h-[90vh] w-auto rounded-lg shadow-2xl" />
                                </div>
                            </DialogContent>
                        </Dialog>
                    ) : (
                        <div className="h-48 flex items-center justify-center bg-muted/20 border rounded-lg text-muted-foreground text-sm border-dashed">
                            No badge history available
                        </div>
                    )}
                </div>
            </div>

            {/* 3. Favorite Games */}
            <div className="p-6">
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                    <Package className="w-5 h-5 text-primary" /> Favorite Games ({data.favorites ? data.favorites.length : 0})
                </h3>
                {data.favorites && data.favorites.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {data.favorites.map((game) => (
                            <a
                                key={game.id}
                                href={`https://www.roblox.com/games/${game.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group flex flex-col items-center gap-2 p-3 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                            >
                                <span className="text-xs font-medium text-center line-clamp-2 w-full group-hover:text-primary transition-colors">
                                    {game.name || `Game ${game.id}`}
                                </span>
                            </a>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground p-4 text-center border rounded-md border-dashed">No favorite games found.</p>
                )}
            </div>

            {/* 4. Assets & Finances */}
            <div className="p-6 bg-muted/5">
                <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-primary" /> Assets & Finances
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                    {/* GamePass Summaries */}
                    <div className="space-y-3">
                        <h4 className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-2">GamePasses</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <SummaryBox label="Total Count" value={stats?.gamePassCount} />
                            <SummaryBox label="Not Created by User" value={stats?.gamePassCount - stats?.selfCreatedPricedGamePassCount} />
                            <SummaryBox label="Total Value" value={`${stats?.gamePassPriceTotal?.toLocaleString()} R$`} highlight className="col-span-2" />
                        </div>
                    </div>

                    {/* Inventory Breakdown */}
                    <div className="space-y-3">
                        <h4 className="text-xs font-bold uppercase text-muted-foreground tracking-wider mb-2">Inventory</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <SummaryBox label="Regular Assets" value={regularAssets.length} sub={`Est. Value: ${data.inventoryValue ? data.inventoryValue.toLocaleString() : 'N/A'}`} highlight />
                            <SummaryBox label="Dev Assets" value={devAssets.length} />
                        </div>
                    </div>
                </div>
            </div>
        </div >
    );
}

// --- Sub Components ---

function ReferenceItem({ data, label, color, badgeVariant, badgeColor }) {
    if (!data) return null;
    return (
        <Dialog>
            <DialogTrigger asChild>
                <div className={`cursor-pointer p-4 rounded-lg border-l-4 transition-all hover:scale-[1.02] active:scale-[0.98] ${color} flex justify-between items-center shadow-md bg-background/50 hover:bg-background/80`}>
                    <div>
                        <div className="font-bold text-sm tracking-wide">{data.username}</div>
                        <div className="text-xs opacity-80">Click to compare</div>
                    </div>
                    <Badge className={`${badgeColor} text-white hover:${badgeColor}`}>
                        {label}
                    </Badge>
                </div>
            </DialogTrigger>
            <DialogContent className="max-w-[90vw] w-[1400px] max-h-[90vh] overflow-y-auto p-0 gap-0 border-none">
                <DialogHeader className="p-6 pb-2 border-b bg-neutral-900 sticky top-0 z-10">
                    <DialogTitle className="flex items-center gap-3 text-xl">
                        Reference: {data.username}
                        <Badge className={`${badgeColor} text-white`}>{label}</Badge>
                    </DialogTitle>
                </DialogHeader>
                <ProfileDetailView data={data} />
            </DialogContent>
        </Dialog>
    );
}

function SkeletonReference() {
    return (
        <div className="p-4 rounded-lg border border-border bg-muted/20 animate-pulse h-[72px]">
            <div className="h-4 bg-muted w-2/3 rounded mb-2"></div>
            <div className="h-3 bg-muted w-1/3 rounded"></div>
        </div>
    )
}

function StatCard({ icon, label, value, highlight }) {
    return (
        <div className={`flex items-center gap-4 p-4 border rounded-xl shadow-sm transition-colors ${highlight ? 'bg-primary/5 border-primary/20' : 'bg-background hover:bg-muted/30'}`}>
            <div className={`p-3 rounded-full ${highlight ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
                {icon ? icon : <div className="w-5 h-5" />}
            </div>
            <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground tracking-wider">{label}</div>
                <div className="text-2xl font-bold tracking-tight">{value != null ? value.toLocaleString() : '0'}</div>
            </div>
        </div>
    );
}

function SummaryBox({ label, value, sub, highlight, className }) {
    return (
        <div className={`p-4 rounded-lg border ${highlight ? 'bg-primary/10 border-primary/30' : 'bg-background border-border'} ${className}`}>
            <div className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">{label}</div>
            <div className={`text-2xl font-black ${highlight ? 'text-primary' : 'text-foreground'}`}>{value != null ? value.toLocaleString() : '0'}</div>
            {sub && <div className="text-xs font-medium text-muted-foreground mt-1">{sub}</div>}
        </div>
    )
}

function VoteButton({ label, onClick, color, disabled }) {
    return (
        <Button
            onClick={onClick}
            disabled={disabled}
            className={`${color} text-white font-bold h-11 px-6 shadow-lg transition-all hover:scale-105 active:scale-95`}
        >
            {label.replace('_', ' ')}
        </Button>
    )
}

function LoadingState() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-lg font-medium text-muted-foreground animate-pulse">Analyzing Candidate Profile...</p>
        </div>
    )
}

function ErrorState({ error, retry }) {
    return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
            <div className="p-6 bg-destructive/10 text-destructive rounded-full border-2 border-destructive/20">
                <AlertTriangle className="h-10 w-10" />
            </div>
            <div className="text-center space-y-2">
                <p className="font-bold text-2xl">Failed to Load Candidate</p>
                <p className="text-muted-foreground max-w-md">{error}</p>
            </div>
            <Button onClick={retry} variant="outline" size="lg">Try Again</Button>
        </div>
    )
}
