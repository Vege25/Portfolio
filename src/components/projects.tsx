import React from 'react';
import Project from './project';
import ProjectProps from '../interfaces/interfaces';

const Projects: React.FC = () => {
  const projects: ProjectProps[] = [
    {
      title: 'Hodaripuoti',
      description: [
        'Introducing Hodaripuoti, a PWA where you can order, customize your hotdogs or choose from a curated menu. ',
        'Built with TypeScript (front-end), JavaScript, Node, Express (backend), and powered by MariaDB on Azure. ',
        'Manage your orders through user profiles, while employees fulfill and track orders. ',
      ],
      imageUrl: './images/projectImages/hodaripuoti.png',
      linkUrl: 'https://github.com/Aihki/hodaripuoti',
      skills: [
        'Typescript',
        'Javascript',
        'Node',
        'Express',
        'SQL',
        'MariaDB',
        'Azure',
        'HTML',
        'CSS',
        'Github',
      ],
    },
    {
      title: 'Brand Design Copy',
      description: [
        `
      I replicated Samsung's web page to showcase my proficiency in front-end development. `,
        'This demonstrates my capability to transform design concepts into fully functional websites. ',
      ],
      imageUrl: './images/projectImages/brand-project-img.png',
      linkUrl: 'https://github.com/Vege25/brand-design-copy',
      skills: [
        'React',
        'Typescript',
        'Tailwind',
        'Vite',
        'HTML',
        'CSS',
        'Github',
      ],
    },
    {
      title: 'Heat Or Not',
      description: [
        'Heat or Not is a full-stack web application inspired by the popular "swipe right" and "swipe left" interaction found in dating apps. ',
        'Users can swipe right to like heated cars or swipe left to skip not heated cars.',
      ],
      imageUrl: './images/projectImages/heatornot.png',
      linkUrl: 'https://github.com/Vege25/Heat-or-not',
      skills: [
        'Javascript',
        'Express',
        'Node',
        'HTML',
        'CSS',
        'Github',
        'MariaDB',
      ],
    },
  ];
  return (
    <section className='px-5' id='projectsElement'>
      <h2 className='text-3xl font-bold text-center'>MY PROJECTS</h2>
      <div className='w-10 h-1 m-auto my-5 rounded-full bg-lightBlue'></div>
      <div className='grid grid-cols-1 gap-4 my-10 md:grid-cols-2'>
        {projects.map((project, index) => (
          <Project key={index} project={project} />
        ))}
      </div>
    </section>
  );
};

export default Projects;
