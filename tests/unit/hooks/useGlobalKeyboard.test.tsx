import { render } from '@testing-library/react';

import { useGlobalKeyboard } from '@src/hooks/useGlobalKeyboard';

const KeyboardListener = () => {
	useGlobalKeyboard();
	return null;
};

describe('useGlobalKeyboard', () => {
	it('opens Quick Open and prevents the browser print shortcut for Ctrl+P', () => {
		const onQuickOpen = jest.fn();
		document.addEventListener('open-file-quick-open', onQuickOpen);
		render(<KeyboardListener />);

		const event = new KeyboardEvent('keydown', {
			bubbles: true,
			cancelable: true,
			code: 'KeyP',
			ctrlKey: true,
		});
		document.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);
		expect(onQuickOpen).toHaveBeenCalledTimes(1);

		document.removeEventListener('open-file-quick-open', onQuickOpen);
	});
});
