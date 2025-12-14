export default function OfficerDashboard() {
    return (
        <div className="container mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold text-white mb-6">Officer Dashboard</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-neutral-900/30 border border-neutral-800 p-6 rounded-lg hover:border-rose-500/50 transition-colors cursor-pointer group">
                    <h3 className="text-xl font-semibold text-neutral-200 group-hover:text-white mb-2">Manage Patrols</h3>
                    <p className="text-neutral-400">View and log patrol activity.</p>
                </div>
                <div className="bg-neutral-900/30 border border-neutral-800 p-6 rounded-lg hover:border-rose-500/50 transition-colors cursor-pointer group">
                    <h3 className="text-xl font-semibold text-neutral-200 group-hover:text-white mb-2">Promotions</h3>
                    <p className="text-neutral-400">View eligibility and submit promotions.</p>
                </div>
                <div className="bg-neutral-900/30 border border-neutral-800 p-6 rounded-lg hover:border-rose-500/50 transition-colors cursor-pointer group">
                    <h3 className="text-xl font-semibold text-neutral-200 group-hover:text-white mb-2">Resources</h3>
                    <p className="text-neutral-400">Access officer documentation and guides.</p>
                </div>
            </div>

            <div className="mt-8 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-500">
                <span className="font-semibold">Note:</span> This section is under construction. More features coming soon.
            </div>
        </div>
    );
}
