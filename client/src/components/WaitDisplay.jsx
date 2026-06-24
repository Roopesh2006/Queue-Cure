export default function WaitDisplay({ currentToken, myToken, tokensAhead, etaMinutes, connected }) {
  return (
    <div className="bg-white rounded-xl shadow-lg p-6 max-w-md mx-auto text-center">
      {!connected && (
        <div className="mb-4 px-3 py-2 bg-yellow-100 text-yellow-800 text-sm rounded-lg">
          Reconnecting...
        </div>
      )}

      <div className="mb-4">
        <p className="text-sm text-gray-500">Now serving</p>
        <p className="text-3xl font-bold text-gray-800">Token #{currentToken || '—'}</p>
      </div>

      <div className="border-t border-gray-200 my-4" />

      <div className="mb-4">
        <p className="text-sm text-gray-500">Your token</p>
        <p className="text-2xl font-semibold text-blue-600">#{myToken}</p>
      </div>

      {tokensAhead !== null && (
        <div>
          <p className="text-sm text-gray-500">
            {tokensAhead === 0 ? (
              <span className="text-green-600 font-medium">You are next. Please proceed to the consultation room.</span>
            ) : (
              <>
                <span className="font-medium">{tokensAhead}</span> patient{tokensAhead !== 1 ? 's' : ''} ahead of you
              </>
            )}
          </p>
          {tokensAhead > 0 && etaMinutes > 0 && (
            <p className="text-lg font-semibold text-gray-700 mt-1">
              Estimated wait: ~{etaMinutes} min
            </p>
          )}
        </div>
      )}
    </div>
  );
}
