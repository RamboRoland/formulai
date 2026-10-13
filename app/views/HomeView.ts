import type { View } from './View';

type ModeButton = {
    label: string;
    href: string;
    bg: string;
    hover: string;
};

const MODE_BUTTONS: ModeButton[] = [
    { label: 'Player Mode',    href: '/racing/player',         bg: '#4CAF50', hover: '#45a049' },
    { label: 'AI Mode',        href: '/racing/ai',             bg: '#2196F3', hover: '#1976D2' },
    { label: 'Multiplayer AI', href: '/racing/multiplayer-ai', bg: '#9C27B0', hover: '#7B1FA2' },
    { label: 'Track Editor',   href: '/track-editor',          bg: '#FF9800', hover: '#F57C00' },
];

const CONTROLS_HELP = [
    'W - Accelerate',
    'S - Reverse',
    'A - Turn Left',
    'D - Turn Right',
    'Space - Brake',
    'R - Reset',
];

// Landing page view. No canvas, no engine, no WebSocket. Renders a title,
// four mode-selection buttons (plain anchors — browser handles navigation
// during the React-migration phase), and a controls cheat-sheet.
export class HomeView implements View {
    private rootEl: HTMLDivElement | null = null;

    public mount(root: HTMLElement): void {
        this.rootEl = this.build();
        root.appendChild(this.rootEl);
    }

    public unmount(): void {
        this.rootEl?.remove();
        this.rootEl = null;
    }

    private build(): HTMLDivElement {
        const container = document.createElement('div');
        Object.assign(container.style, {
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh',
            backgroundColor: '#1a1a1a',
            color: 'white',
            fontFamily: 'Arial, sans-serif',
        });

        const title = document.createElement('h1');
        title.textContent = 'Formulai Racing';
        Object.assign(title.style, { fontSize: '48px', marginBottom: '20px' });
        container.appendChild(title);

        const subtitle = document.createElement('p');
        subtitle.textContent = 'Choose your racing mode';
        Object.assign(subtitle.style, { fontSize: '24px', marginBottom: '40px' });
        container.appendChild(subtitle);

        const buttonRow = document.createElement('div');
        Object.assign(buttonRow.style, {
            display: 'flex',
            gap: '20px',
            flexWrap: 'wrap',
            justifyContent: 'center',
        });
        for (const btn of MODE_BUTTONS) {
            buttonRow.appendChild(this.makeButton(btn));
        }
        container.appendChild(buttonRow);

        container.appendChild(this.makeControlsSection());

        return container;
    }

    private makeButton({ label, href, bg, hover }: ModeButton): HTMLAnchorElement {
        const a = document.createElement('a');
        a.textContent = label;
        a.href = href;
        Object.assign(a.style, {
            padding: '15px 30px',
            fontSize: '20px',
            backgroundColor: bg,
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer',
            transition: 'background-color 0.3s',
            textDecoration: 'none',
        });
        a.addEventListener('mouseover', () => { a.style.backgroundColor = hover; });
        a.addEventListener('mouseout',  () => { a.style.backgroundColor = bg; });
        return a;
    }

    private makeControlsSection(): HTMLDivElement {
        const section = document.createElement('div');
        Object.assign(section.style, { marginTop: '40px', textAlign: 'center' });

        const heading = document.createElement('h2');
        heading.textContent = 'Controls';
        Object.assign(heading.style, { fontSize: '24px', marginBottom: '20px' });
        section.appendChild(heading);

        CONTROLS_HELP.forEach((text, i) => {
            const p = document.createElement('p');
            p.textContent = text;
            Object.assign(p.style, {
                fontSize: '18px',
                marginBottom: i === CONTROLS_HELP.length - 1 ? '0' : '10px',
            });
            section.appendChild(p);
        });

        return section;
    }
}
