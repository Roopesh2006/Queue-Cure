export default function QueueTable({ queue, currentToken, rollingAvgMs }) {
  if (!queue || queue.length === 0) {
    return (
      <div className="text-gray-500 text-center py-8">
        Queue is empty — add patients above
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Token</th>
            <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">Name</th>
            <th className="text-left py-3 px-4 text-sm font-semibold text-gray-600">ETA</th>
          </tr>
        </thead>
        <tbody>
          {queue.map((patient, index) => (
            <tr key={patient.id} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-3 px-4 text-sm font-mono">{patient.token}</td>
              <td className="py-3 px-4 text-sm">{patient.name}</td>
              <td className="py-3 px-4 text-sm text-gray-500">
                {rollingAvgMs > 0
                  ? `~${Math.ceil((index + 1) * rollingAvgMs / 60000)} min`
                  : '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
