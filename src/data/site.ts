import type { ImageMetadata } from 'astro';
import threadle from '../assets/earlier/threadle.png';
import hodaripuoti from '../assets/earlier/hodaripuoti.png';
import heatOrNot from '../assets/earlier/heat-or-not.webp';
import brandCopy from '../assets/earlier/brand-copy.webp';
import ravintolat from '../assets/earlier/ravintolat.png';

export const site = {
  name: 'Veeti Sorakivi',
  role: 'Software engineer',
  city: 'Tampere',
  email: 'v.sorakivi@gmail.com',
  description:
    'Veeti Sorakivi, software engineer in Tampere. I build software for real problems: a budgeting app, a multiplayer card game, a desk display and a GPS navigation device for hiking.',
  links: {
    github: 'https://github.com/Vege25',
    linkedin: 'https://www.linkedin.com/in/veeti-sorakivi-a5a556253/',
  },
};

export interface TimelineItem {
  when: string;
  title: string;
  where: string;
  text: string;
  stack?: string[];
  link?: { label: string; href: string };
}

export const timeline: TimelineItem[] = [
  {
    when: 'Now',
    title: 'Software developer',
    where: 'MyCashflow',
    text: 'Software development for MyCashflow, a Finnish e-commerce platform that online stores are built and run on.',
    stack: ['PHP', 'Symfony'],
  },
  {
    when: '2025',
    title: 'Bachelor of Engineering, ICT',
    where: 'Metropolia UAS',
    text: 'Graduated in January 2025, majoring in web development and digital media. My thesis was a multiplayer card game: I tested the rules as a physical board game first, then built it in the Godot engine with its own user and game servers, and published it on itch.io. That game grew into Buddyfall.',
    stack: ['Godot', 'GDScript', 'TypeScript', 'Node', 'WebSockets'],
    link: { label: 'Thesis (in Finnish)', href: 'https://urn.fi/URN:NBN:fi:amk-202501282035' },
  },
  {
    when: '2024',
    title: 'Innovation project',
    where: 'Retail company',
    text: 'The company was moving to two new systems, and about 10,000 products had to go with it. Typing them in by hand would have taken weeks. I built a tool that turned the old system’s CSV exports into the new systems’ import format, with bulk stock updates and cleaned-up colour codes, plus a Python script that fetched all the product images.',
    stack: ['JavaScript', 'Python', 'CSV'],
    link: { label: 'Project report (in Finnish)', href: '/Veeti_Sorakivi_Innovaatioprojekti_Raportti.pdf' },
  },
];

export interface EarlierProject {
  name: string;
  year: string;
  text: string;
  stack: string[];
  image: ImageMetadata;
  links: { label: string; href: string }[];
}

export const earlier: EarlierProject[] = [
  {
    name: 'Threadle',
    year: '2024',
    text: 'A marketplace for handicrafts. Listings, chat between users and profiles. Group project.',
    stack: ['React', 'TypeScript', 'Node', 'Express', 'MariaDB'],
    image: threadle,
    links: [
      { label: 'Frontend', href: 'https://github.com/elinaasa/ThreadleFrontend' },
      { label: 'Backend', href: 'https://github.com/Vege25/threadle-backend' },
    ],
  },
  {
    name: 'Hodaripuoti',
    year: '2023',
    text: 'A PWA for ordering hot dogs. Customers build their own or pick from the menu, staff track the orders. Group project.',
    stack: ['TypeScript', 'Node', 'Express', 'MariaDB', 'Azure'],
    image: hodaripuoti,
    links: [{ label: 'GitHub', href: 'https://github.com/Aihki/hodaripuoti' }],
  },
  {
    name: 'Heat or Not',
    year: '2024',
    text: 'Swipe right on cars you like, left on the ones you don’t.',
    stack: ['JavaScript', 'Node', 'Express', 'MariaDB'],
    image: heatOrNot,
    links: [{ label: 'GitHub', href: 'https://github.com/Vege25/Heat-or-not' }],
  },
  {
    name: 'Samsung front page',
    year: '2024',
    text: 'Samsung’s front page rebuilt from scratch, to practise turning a design into a working site.',
    stack: ['React', 'TypeScript', 'Tailwind'],
    image: brandCopy,
    links: [{ label: 'GitHub', href: 'https://github.com/Vege25/brand-design-copy' }],
  },
  {
    name: 'Student restaurants',
    year: '2023',
    text: 'Finds student restaurants near you and shows their daily and weekly menus.',
    stack: ['TypeScript', 'PWA'],
    image: ravintolat,
    links: [{ label: 'GitHub', href: 'https://github.com/Vege25/yksilotehtava' }],
  },
];
