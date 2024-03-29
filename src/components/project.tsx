import React from 'react';
import ProjectProps from '../interfaces/interfaces';
import LightButton from './buttons/lightButton';
interface props {
  project: ProjectProps;
}

const Project: React.FC<props> = ({ project }) => {
  const { title, description, imageUrl, linkUrl, skills, webUrl } = project;
  const handleClick = () => {
    window.open(linkUrl, '_blank');
  };
  return (
    <div
      style={{
        boxShadow: '0px 1px 21px -1px rgba(102,252,241,0.49);',
        WebkitBoxShadow: '0px 1px 21px -1px rgba(102,252,241,0.49);',
        MozBoxShadow: '0px 1px 21px -1px rgba(102,252,241,0.49);',
      }}
      className='w-full text-white group bg-lightGray bg-opacity-10 rounded-xl'
    >
      <div
        onClick={handleClick}
        style={{ backgroundImage: `url(${imageUrl})` }}
        className='bg-top bg-cover rounded-bl-none rounded-br-none cursor-pointer rounded-tl-xl h-72 rounded-tr-xl'
      />
      <div className='px-6 py-10 pb-6'>
        <h4 className='text-lg font-bold'>{title}</h4>
        {description.map((desc, index) => (
          <p className='py-1' key={index}>
            {desc}
          </p>
        ))}

        <div className='flex flex-wrap gap-2 pt-6'>
          {skills?.map((skill, index) => (
            <div key={index}>
              <LightButton text={skill} />
            </div>
          ))}
        </div>
        <div className='flex items-center justify-center gap-2 pt-4'>
          <button
            onClick={handleClick}
            className='px-4 py-2 font-bold text-black transition-all duration-150 ease-in-out rounded-lg bg-lightBlue hover:scale-105'
          >
            GitHub
          </button>
          {webUrl && (
            <button
              onClick={() => window.open(webUrl, '_blank')}
              className='px-4 py-2 font-bold text-black transition-all duration-150 ease-in-out rounded-lg bg-lightBlue hover:scale-105'
            >
              Website
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Project;
