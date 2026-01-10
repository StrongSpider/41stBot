import { Link } from 'react-router-dom';

export default function OfficerDashboard() {
    return (
        <div className="container mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold text-white mb-6">Officer Dashboard</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Link to="/officer/labeling" className="bg-neutral-900/30 border border-neutral-800 p-6 rounded-lg hover:border-rose-500/50 transition-colors cursor-pointer group">
                    <h3 className="text-xl font-semibold text-neutral-200 group-hover:text-white mb-2">AI Training</h3>
                    <p className="text-neutral-400">Label accounts to train the Background Check AI.</p>
                </Link>
            </div>
        </div>
    );
}
