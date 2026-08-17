import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import QuickOpen from '@src/components/editor/QuickOpen';
import { useFileTree } from '@src/hooks/useFileTree';

jest.mock('@src/hooks/useFileTree', () => ({
	useFileTree: jest.fn(),
}));

const mockUseFileTree = useFileTree as jest.MockedFunction<typeof useFileTree>;

describe('QuickOpen', () => {
	beforeEach(() => {
		mockUseFileTree.mockReturnValue({
			fileTree: [
				{
					id: 'report',
					name: 'research-report.tex',
					path: '/drafts/research-report.tex',
					type: 'file',
					lastModified: 0,
				},
			],
		} as ReturnType<typeof useFileTree>);
	});

	it('opens from the global shortcut event and selects a fuzzy-matched file', async () => {
		const user = userEvent.setup();
		const onFileSelect = jest.fn();
		render(<QuickOpen onFileSelect={onFileSelect} />);

		act(() => document.dispatchEvent(new CustomEvent('open-file-quick-open')));

		const input = screen.getByRole('textbox', { name: 'Search files' });
		await user.type(input, 'rsrp');
		await user.click(screen.getByRole('option'));

		expect(onFileSelect).toHaveBeenCalledWith('report');
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});
});
